import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

async function loadWorkflow(name) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  return { source, parsed: parse(source) };
}

test('desktop producer namespaces matrix artifacts and aggregates only desktop artifacts', async () => {
  const { parsed } = await loadWorkflow('build-desktop.yml');
  const packageUploads = parsed.jobs.package.steps.filter(
    (step) => step.uses?.startsWith('actions/upload-artifact@'),
  );
  assert.ok(packageUploads.length > 0, 'desktop package job must upload matrix artifacts');
  for (const upload of packageUploads) {
    assert.match(upload.with.name, /^desktop-/u);
  }

  const aggregateDownload = parsed.jobs.release.steps.find(
    (step) => step.uses?.startsWith('actions/download-artifact@'),
  );
  assert.equal(aggregateDownload.with.pattern, 'desktop-*');
  assert.equal(aggregateDownload.with['merge-multiple'], true);
  assert.equal(aggregateDownload.with.name, undefined);
});

test('coordinator maps only the four Android signing secrets explicitly', async () => {
  const { source, parsed } = await loadWorkflow('release.yml');
  assert.doesNotMatch(source, /secrets:\s*inherit/u);
  assert.deepEqual(parsed.jobs.android.secrets, {
    ANDROID_KEYSTORE_BASE64: '${{ secrets.ANDROID_KEYSTORE_BASE64 }}',
    ANDROID_KEY_ALIAS: '${{ secrets.ANDROID_KEY_ALIAS }}',
    ANDROID_KEY_PASSWORD: '${{ secrets.ANDROID_KEY_PASSWORD }}',
    ANDROID_STORE_PASSWORD: '${{ secrets.ANDROID_STORE_PASSWORD }}',
  });
});

test('dependency validation stays read-only and publisher has no dependency lifecycle', async () => {
  const { parsed } = await loadWorkflow('release.yml');
  const validation = parsed.jobs.validate;
  const publisher = parsed.jobs.publish;
  assert.deepEqual(new Set(validation.needs), new Set(['android', 'desktop']));
  assert.equal(validation.permissions.contents, 'read');
  assert.equal(publisher.permissions.contents, 'write');
  assert.equal(publisher.needs, 'validate');

  const publisherText = JSON.stringify(publisher);
  assert.doesNotMatch(publisherText, /npm ci|actions\/setup-node@/u);

  for (const workflowName of ['build-android.yml', 'build-desktop.yml', 'release.yml']) {
    const workflow = await loadWorkflow(workflowName);
    for (const job of Object.values(workflow.parsed.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/checkout@')) {
          assert.equal(
            step.with?.['persist-credentials'],
            false,
            `${workflowName} checkout must not persist credentials`,
          );
        }
      }
    }
  }
});

test('publisher rejects public reruns and publishes only an exact complete draft asset set', async () => {
  const { parsed } = await loadWorkflow('release.yml');
  const publisher = parsed.jobs.publish;
  const script = publisher.steps.find((step) => step.name === 'Publish validated draft atomically')?.run;
  assert.ok(script, 'publisher must have one guarded publication script');

  assert.match(script, /gh release view[^\n]*--json isDraft/u);
  assert.match(script, /if \[ "\$release_state" = "false" \]/u);
  assert.match(script, /exit 1/u);
  assert.match(script, /gh release create[^\n]*--draft/u);
  assert.match(script, /gh release upload[^\n]*--clobber/u);
  assert.match(script, /gh release view[^\n]*--json isDraft,assets/u);
  assert.match(script, /cmp -s "\$expected_assets" "\$remote_assets"/u);
  assert.match(script, /Remote release assets do not exactly match/u);
  assert.match(script, /gh release edit[^\n]*--draft=false/u);

  const uploadIndex = script.indexOf('gh release upload');
  const remoteValidationIndex = script.indexOf('--json isDraft,assets');
  const publishIndex = script.indexOf('gh release edit');
  assert.ok(uploadIndex < remoteValidationIndex, 'remote validation must follow draft upload');
  assert.ok(remoteValidationIndex < publishIndex, 'draft must validate before becoming public');
});
