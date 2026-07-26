import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyReleaseArtifacts } from './verify-release-artifacts.mjs';

const completeInstallerSet = [
  'Codex-Pet-Pause-0.2.0-mac-arm64.dmg',
  'Codex-Pet-Pause-0.2.0-mac-x64.dmg',
  'Codex-Pet-Pause-0.2.0-windows-x64.exe',
  'Codex-Pet-Pause-0.2.0-linux-x64.AppImage',
  'Codex-Pet-Pause-0.2.0-linux-x64.deb',
];

test('accepts one complete 0.2.0 installer set', () => {
  assert.deepEqual(verifyReleaseArtifacts(completeInstallerSet, '0.2.0'), []);
});

test('reports every missing platform package', () => {
  const failures = verifyReleaseArtifacts([], '0.2.0');
  assert.equal(failures.length, 5);
});

test('filters the expected installer set to one requested platform', () => {
  assert.deepEqual(verifyReleaseArtifacts(completeInstallerSet.slice(0, 2), '0.2.0', 'mac'), []);
  assert.deepEqual(verifyReleaseArtifacts(completeInstallerSet.slice(2, 3), '0.2.0', 'windows'), []);
  assert.deepEqual(verifyReleaseArtifacts(completeInstallerSet.slice(3), '0.2.0', 'linux'), []);

  assert.equal(verifyReleaseArtifacts([], '0.2.0', 'mac').length, 2);
  assert.equal(verifyReleaseArtifacts([], '0.2.0', 'windows').length, 1);
  assert.equal(verifyReleaseArtifacts([], '0.2.0', 'linux').length, 2);
});

test('requires exact public artifact filenames', () => {
  const failures = verifyReleaseArtifacts([
    'prefix-Codex-Pet-Pause-0.2.0-mac-arm64.dmg',
    'Codex-Pet-Pause-0x2x0-mac-x64.dmg',
  ], '0.2.0', 'mac');
  assert.equal(failures.length, 2);
});

test('the executable --platform option validates only that platform', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-release-'));
  const script = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url));

  try {
    for (const fileName of completeInstallerSet.slice(0, 2)) {
      await writeFile(join(directory, fileName), '');
    }

    const macResult = spawnSync(process.execPath, [script, directory, '--platform', 'mac'], {
      encoding: 'utf8',
    });
    assert.equal(macResult.status, 0, macResult.stderr);

    const allResult = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.notEqual(allResult.status, 0);
    assert.match(allResult.stderr, /windows-x64/);
    assert.match(allResult.stderr, /linux-x64\.AppImage/);
    assert.match(allResult.stderr, /linux-x64\.deb/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
