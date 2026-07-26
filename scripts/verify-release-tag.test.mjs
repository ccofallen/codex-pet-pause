import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-release-tag.mjs', import.meta.url));
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const expectedTag = `v${packageJson.version}`;

test('accepts exactly v followed by the package version', () => {
  const result = spawnSync(process.execPath, [script, expectedTag], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects semantically different or loosely formatted tags', () => {
  for (const tag of [
    packageJson.version,
    `v${packageJson.version}.0`,
    `v${packageJson.version}-beta.1`,
    'v0.2',
    'v00.2.0',
  ]) {
    const result = spawnSync(process.execPath, [script, tag], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${tag} must be rejected`);
    assert.match(result.stderr, new RegExp(`Expected release tag ${expectedTag.replaceAll('.', '\\.')}`));
  }
});

test('rejects a missing tag argument', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});
