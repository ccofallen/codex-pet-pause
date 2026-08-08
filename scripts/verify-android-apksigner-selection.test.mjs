import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const verifierUrl = new URL('./verify-android-release.mjs', import.meta.url);
const workflowUrl = new URL('../.github/workflows/build-android.yml', import.meta.url);
const releaseWorkflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);

test('Android release verification uses the pinned apksigner from the workflow', async () => {
  const [verifier, workflow, releaseWorkflow] = await Promise.all([
    readFile(verifierUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
    readFile(releaseWorkflowUrl, 'utf8'),
  ]);

  assert.match(verifier, /process\.env\.ANDROID_APKSIGNER\?\.trim\(\)/u);
  assert.match(
    workflow,
    /ANDROID_APKSIGNER="\$APKSIGNER" node scripts\/verify-android-release\.mjs/u,
  );
  assert.match(releaseWorkflow, /sdkmanager "build-tools;36\.0\.0"/u);
  assert.match(
    releaseWorkflow,
    /ANDROID_APKSIGNER="\$APKSIGNER" node scripts\/verify-android-release\.mjs/u,
  );
});
