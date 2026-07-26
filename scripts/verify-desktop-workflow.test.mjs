import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

const actionlintRun = 'docker run --rm -v "$GITHUB_WORKSPACE:/workspace" -w /workspace rhysd/actionlint:1.7.12 .github/workflows/build-desktop.yml';
const tagPushCondition = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";
const tagVersionRun = 'node scripts/verify-release-tag.mjs "${{ github.ref_name }}"';
const packagedAppSmokeRun = 'npm run desktop:smoke:packaged-app';
const publishRun = 'if gh release view "$GITHUB_REF_NAME"; then\n  gh release view "$GITHUB_REF_NAME" --json assets --jq \'.assets[].name\' | while IFS= read -r asset; do\n    gh release delete-asset "$GITHUB_REF_NAME" "$asset" --yes\n  done\n  gh release upload "$GITHUB_REF_NAME" release-assets/*\nelse\n  gh release create "$GITHUB_REF_NAME" release-assets/* --generate-notes --title "Codex Pet Pause $GITHUB_REF_NAME"\nfi\n';

const validWorkflow = {
  on: {
    push: {
      branches: ['main'],
      tags: ['v*'],
    },
    pull_request: {},
    workflow_dispatch: {},
  },
  permissions: { contents: 'write' },
  jobs: {
    validate: {
      'runs-on': 'ubuntu-latest',
      steps: [
        { uses: 'actions/checkout@v4' },
        { uses: 'actions/setup-node@v4', with: { 'node-version': 22, cache: 'npm' } },
        { run: 'npm ci' },
        { run: 'npm run test:desktop-release-config' },
        { run: 'npm run test:brand-assets' },
        { run: 'npm run test:desktop-workflow' },
        { run: 'npm run test:release-artifacts' },
        { run: 'npm run test:release-tag' },
        { run: 'npm run test:packaged-resources' },
        { run: 'npm run test:packaged-app' },
        { run: 'npm run check:desktop-release-config' },
        { run: 'npm run test:run' },
        { run: 'npm run build' },
        { run: 'npm run test:e2e' },
        { name: 'Validate workflow syntax with actionlint', run: actionlintRun },
      ],
    },
    package: {
      needs: 'validate',
      if: tagPushCondition,
      strategy: {
        matrix: {
          include: [
            {
              id: 'mac-arm64',
              platform: 'mac',
              os: 'macos-latest',
              command: 'npm run desktop:pack:mac -- --arm64',
              artifact: 'release/*-mac-arm64.dmg',
            },
            {
              id: 'mac-x64',
              platform: 'mac',
              os: 'macos-latest',
              command: 'npm run desktop:pack:mac -- --x64',
              artifact: 'release/*-mac-x64.dmg',
            },
            {
              id: 'windows-x64',
              platform: 'windows',
              os: 'windows-latest',
              command: 'npm run desktop:pack:win -- --x64',
              artifact: 'release/*-windows-x64.exe',
            },
            {
              id: 'linux-x64',
              platform: 'linux',
              os: 'ubuntu-latest',
              command: 'npm run desktop:pack:linux -- --x64',
              artifact: 'release/*-linux-x64.AppImage\nrelease/*-linux-x64.deb\n',
            },
          ],
        },
      },
      'runs-on': '${{ matrix.os }}',
      steps: [
        { uses: 'actions/checkout@v4' },
        { uses: 'actions/setup-node@v4', with: { 'node-version': 22, cache: 'npm' } },
        { run: 'npm ci' },
        { run: tagVersionRun },
        { run: '${{ matrix.command }}' },
        { run: packagedAppSmokeRun },
        { run: 'node scripts/verify-release-artifacts.mjs release --platform ${{ matrix.platform }}' },
        {
          uses: 'actions/upload-artifact@v4',
          with: {
            name: '${{ matrix.id }}',
            path: '${{ matrix.artifact }}',
            'if-no-files-found': 'error',
          },
        },
      ],
    },
    release: {
      needs: 'package',
      if: tagPushCondition,
      'runs-on': 'ubuntu-latest',
      steps: [
        { uses: 'actions/checkout@v4' },
        { run: tagVersionRun },
        {
          uses: 'actions/download-artifact@v4',
          with: { path: 'release-assets', 'merge-multiple': true },
        },
        { run: 'node scripts/verify-release-artifacts.mjs release-assets' },
        {
          name: 'Publish release assets',
          env: { GH_TOKEN: '${{ github.token }}' },
          run: publishRun,
        },
      ],
    },
  },
};

test('workflow validates, packages every target, and publishes tag pushes', async () => {
  const workflow = parse(await readFile('.github/workflows/build-desktop.yml', 'utf8'));
  assert.deepEqual(verifyDesktopWorkflow(workflow), []);
});

test('accepts the in-memory validation, packaging, and release contract', () => {
  assert.deepEqual(verifyDesktopWorkflow(validWorkflow), []);
});

test('rejects a workflow that does not publish v* tags', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.on.push.tags = ['release-*'];
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('v* tags')));
});

test('rejects an actionlint invocation with an entrypoint argument', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.validate.steps.at(-1).run = `${actionlintRun.replace(' .github', ' actionlint .github')}`;
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('actionlint')));
});

test('rejects validation that skips workflow or artifact regression tests', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.validate.steps = invalid.jobs.validate.steps.filter(
    (step) => ![
      'npm run test:desktop-workflow',
      'npm run test:release-artifacts',
    ].includes(step.run),
  );
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('desktop workflow tests')));
  assert.ok(failures.some((failure) => failure.includes('release artifact tests')));
});

test('rejects validation that skips tag, packaged-resource, packaged-app, or E2E regressions', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.validate.steps = invalid.jobs.validate.steps.filter(
    (step) => ![
      'npm run test:release-tag',
      'npm run test:packaged-resources',
      'npm run test:packaged-app',
      'npm run test:e2e',
    ].includes(step.run),
  );
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('release tag tests')));
  assert.ok(failures.some((failure) => failure.includes('packaged resource tests')));
  assert.ok(failures.some((failure) => failure.includes('packaged app tests')));
  assert.ok(failures.some((failure) => failure.includes('existing E2E tests')));
});

test('rejects package and release jobs that run outside tag pushes', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.if = "startsWith(github.ref, 'refs/tags/v')";
  invalid.jobs.release.if = "github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')";
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('package job must run only for v* tag pushes')));
  assert.ok(failures.some((failure) => failure.includes('release job must run only for v* tag pushes')));
});

test('rejects a workflow with a missing native package target or command', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.strategy.matrix.include[0].command = undefined;
  invalid.jobs.package.strategy.matrix.include.pop();
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('mac-arm64 command')));
  assert.ok(failures.some((failure) => failure.includes('linux-x64')));
});

test('rejects packaging without npm ci or a protected matrix artifact upload', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.steps = invalid.jobs.package.steps.filter((step) => step.run !== 'npm ci');
  const upload = invalid.jobs.package.steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  upload.with.path = 'release/*';
  upload.with['if-no-files-found'] = 'warn';
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('package job must run npm ci')));
  assert.ok(failures.some((failure) => failure.includes('matrix artifact path')));
  assert.ok(failures.some((failure) => failure.includes('if-no-files-found')));
});

test('rejects native package entries without the validator platform', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.strategy.matrix.include[0].platform = 'windows';
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('mac-arm64 validator platform')),
  );
});

test('rejects package artifact validation that does not run after the native build', () => {
  const invalid = structuredClone(validWorkflow);
  const steps = invalid.jobs.package.steps;
  const validation = steps.splice(steps.findIndex((step) => step.run?.includes('verify-release-artifacts')), 1)[0];
  steps.splice(steps.findIndex((step) => step.run === '${{ matrix.command }}'), 0, validation);
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('after the matrix command')),
  );
});

test('rejects packaging without an exact tag check before the native build', () => {
  const invalid = structuredClone(validWorkflow);
  const steps = invalid.jobs.package.steps;
  const tagCheck = steps.splice(steps.findIndex((step) => step.run === tagVersionRun), 1)[0];
  steps.splice(steps.findIndex((step) => step.run === '${{ matrix.command }}') + 1, 0, tagCheck);
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('tag version before packaging')),
  );
});

test('rejects POSIX-only release-tag expansion in Windows-capable jobs', () => {
  const invalid = structuredClone(validWorkflow);
  for (const jobName of ['package', 'release']) {
    invalid.jobs[jobName].steps.find((step) => step.run === tagVersionRun).run =
      'node scripts/verify-release-tag.mjs "$GITHUB_REF_NAME"';
  }
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('portable tag expression before packaging')));
  assert.ok(failures.some((failure) => failure.includes('portable tag expression before publishing')));
});

test('rejects packaging without an actual packaged-app smoke after the native build', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.steps = invalid.jobs.package.steps.filter(
    (step) => step.run !== packagedAppSmokeRun,
  );
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('packaged app smoke')),
  );
});

test('rejects a workspace-dist smoke in place of packaged app.asar validation', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.steps.find((step) => step.run === packagedAppSmokeRun).run =
    'npm run desktop:smoke:packaged-resources';
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('packaged app smoke')),
  );
});

test('rejects a nested or unvalidated complete release artifact set', () => {
  const invalid = structuredClone(validWorkflow);
  const steps = invalid.jobs.release.steps;
  const download = steps.find((step) => step.uses === 'actions/download-artifact@v4');
  download.with['merge-multiple'] = false;
  const validation = steps.splice(steps.findIndex((step) => step.run?.includes('verify-release-artifacts')), 1)[0];
  steps.push(validation);
  const failures = verifyDesktopWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('merge artifacts into one directory')));
  assert.ok(failures.some((failure) => failure.includes('before publishing')));
});

test('rejects release checkout that occurs after complete artifact validation', () => {
  const invalid = structuredClone(validWorkflow);
  const steps = invalid.jobs.release.steps;
  const checkout = steps.splice(steps.findIndex((step) => step.uses === 'actions/checkout@v4'), 1)[0];
  const validationIndex = steps.findIndex((step) => step.run?.includes('verify-release-artifacts'));
  steps.splice(validationIndex + 1, 0, checkout);
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('check out before artifact validation')),
  );
});

test('rejects publishing without an exact tag check after checkout', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.release.steps = invalid.jobs.release.steps.filter(
    (step) => step.run !== tagVersionRun,
  );
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('tag version before publishing')),
  );
});

test('rejects release reruns that can retain stale public assets', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.release.steps.find((step) => step.name === 'Publish release assets').run =
    publishRun.replace(
      '  gh release view "$GITHUB_REF_NAME" --json assets --jq \'.assets[].name\' | while IFS= read -r asset; do\n    gh release delete-asset "$GITHUB_REF_NAME" "$asset" --yes\n  done\n',
      '',
    );
  assert.ok(
    verifyDesktopWorkflow(invalid).some((failure) => failure.includes('delete existing release assets')),
  );
});

test('rejects a release that does not wait for packaging', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.release.needs = 'validate';
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('package job')));
});
