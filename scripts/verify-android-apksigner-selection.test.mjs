import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const verifierUrl = new URL('./verify-android-release.mjs', import.meta.url);
const workflowUrl = new URL('../.github/workflows/build-android.yml', import.meta.url);

test('Android release verification uses the pinned apksigner from the workflow', async () => {
  const [verifier, workflow] = await Promise.all([
    readFile(verifierUrl, 'utf8'),
    readFile(workflowUrl, 'utf8'),
  ]);

  assert.match(verifier, /process\.env\.ANDROID_APKSIGNER\?\.trim\(\)/u);
  assert.match(
    workflow,
    /ANDROID_APKSIGNER="\$APKSIGNER" node scripts\/verify-android-release\.mjs/u,
  );
});
