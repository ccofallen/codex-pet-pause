import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const platformSidecars = {
  mac: [
    'Codex-Pet-Pause-0.2.0-mac-arm64.dmg.blockmap',
    'Codex-Pet-Pause-0.2.0-mac-x64.dmg.blockmap',
  ],
  windows: [
    'Codex-Pet-Pause-0.2.0-windows-x64.exe.blockmap',
  ],
};
const invalidLinuxSidecar = 'Codex-Pet-Pause-0.2.0-linux-x64.AppImage.blockmap';

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

test('validates exactly one native matrix target and its exact sidecars', () => {
  assert.deepEqual(verifyReleaseArtifacts([
    completeInstallerSet[0],
    platformSidecars.mac[0],
    'builder-effective-config.yaml',
    'latest-mac.yml',
  ], '0.2.0', 'mac-arm64'), []);
  assert.deepEqual(verifyReleaseArtifacts([
    completeInstallerSet[1],
    platformSidecars.mac[1],
  ], '0.2.0', 'mac-x64'), []);
  assert.deepEqual(verifyReleaseArtifacts([
    completeInstallerSet[2],
    ...platformSidecars.windows,
    'latest.yml',
  ], '0.2.0', 'windows-x64'), []);
  assert.deepEqual(verifyReleaseArtifacts([
    ...completeInstallerSet.slice(3),
    'latest-linux.yml',
  ], '0.2.0', 'linux-x64'), []);
});

test('target scope rejects sibling installers and sidecars from another matrix job', () => {
  const failures = verifyReleaseArtifacts([
    completeInstallerSet[0],
    completeInstallerSet[1],
    ...platformSidecars.mac,
  ], '0.2.0', 'mac-arm64');
  assert.deepEqual(failures, [
    `Unexpected release artifact: ${completeInstallerSet[1]}`,
    `Unexpected release artifact: ${platformSidecars.mac[1]}`,
  ]);
});

test('Linux target scope rejects the non-generated AppImage sidecar', () => {
  assert.deepEqual(verifyReleaseArtifacts([
    ...completeInstallerSet.slice(3),
    invalidLinuxSidecar,
  ], '0.2.0', 'linux-x64'), [
    `Unexpected release artifact: ${invalidLinuxSidecar}`,
  ]);
});

test('requires exact public artifact filenames', () => {
  const failures = verifyReleaseArtifacts([
    'prefix-Codex-Pet-Pause-0.2.0-mac-arm64.dmg',
    'Codex-Pet-Pause-0x2x0-mac-x64.dmg',
  ], '0.2.0', 'mac');
  assert.equal(failures.length, 4);
  assert.ok(failures.some((failure) => failure.includes('Unexpected release artifact: prefix-')));
  assert.ok(failures.some((failure) => failure.includes('Unexpected release artifact: Codex-Pet-Pause-0x2x0')));
});

test('rejects stale or cross-platform public packages for the selected scope', () => {
  const failures = verifyReleaseArtifacts([
    ...completeInstallerSet.slice(0, 2),
    completeInstallerSet[2],
    'Codex-Pet-Pause-0.1.0-mac-arm64.dmg',
  ], '0.2.0', 'mac');
  assert.deepEqual(failures, [
    `Unexpected release artifact: ${completeInstallerSet[2]}`,
    'Unexpected release artifact: Codex-Pet-Pause-0.1.0-mac-arm64.dmg',
  ]);
});

test('tolerates only known electron-builder metadata during platform packaging', () => {
  assert.deepEqual(verifyReleaseArtifacts([
    ...completeInstallerSet.slice(0, 2),
    'builder-debug.yml',
    'builder-effective-config.yaml',
    'latest-mac.yml',
  ], '0.2.0', 'mac'), []);

  const failures = verifyReleaseArtifacts([
    ...completeInstallerSet.slice(0, 2),
    'latest.yml',
    'notes.txt',
  ], '0.2.0', 'mac');
  assert.deepEqual(failures, [
    'Unexpected release artifact: latest.yml',
    'Unexpected release artifact: notes.txt',
  ]);
});

test('tolerates exact versioned sidecars generated for mac and Windows targets', () => {
  assert.deepEqual(verifyReleaseArtifacts([
    ...completeInstallerSet.slice(0, 2),
    ...platformSidecars.mac,
  ], '0.2.0', 'mac'), []);
  assert.deepEqual(verifyReleaseArtifacts([
    completeInstallerSet[2],
    ...platformSidecars.windows,
  ], '0.2.0', 'windows'), []);
});

test('rejects a separate Linux AppImage blockmap because electron-builder embeds it', () => {
  assert.deepEqual(verifyReleaseArtifacts([
    ...completeInstallerSet.slice(3),
    invalidLinuxSidecar,
  ], '0.2.0', 'linux'), [
    `Unexpected release artifact: ${invalidLinuxSidecar}`,
  ]);
});

test('rejects wrong-version, cross-platform, and unconfigured blockmaps', () => {
  const failures = verifyReleaseArtifacts([
    ...completeInstallerSet.slice(0, 2),
    'Codex-Pet-Pause-0.1.0-mac-arm64.dmg.blockmap',
    platformSidecars.windows[0],
    'Codex-Pet-Pause-0.2.0-mac-arm64.zip.blockmap',
  ], '0.2.0', 'mac');
  assert.deepEqual(failures, [
    'Unexpected release artifact: Codex-Pet-Pause-0.1.0-mac-arm64.dmg.blockmap',
    `Unexpected release artifact: ${platformSidecars.windows[0]}`,
    'Unexpected release artifact: Codex-Pet-Pause-0.2.0-mac-arm64.zip.blockmap',
  ]);
});

test('rejects all metadata and unknown files in the complete release asset set', () => {
  const failures = verifyReleaseArtifacts([
    ...completeInstallerSet,
    'builder-effective-config.yaml',
    'latest-mac.yml',
    ...platformSidecars.mac,
    ...platformSidecars.windows,
    invalidLinuxSidecar,
  ], '0.2.0');
  assert.deepEqual(failures, [
    'Unexpected release artifact: builder-effective-config.yaml',
    'Unexpected release artifact: latest-mac.yml',
    ...platformSidecars.mac.map((fileName) => `Unexpected release artifact: ${fileName}`),
    ...platformSidecars.windows.map((fileName) => `Unexpected release artifact: ${fileName}`),
    `Unexpected release artifact: ${invalidLinuxSidecar}`,
  ]);
});

test('the executable --platform option validates only that platform', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-release-'));
  const script = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url));

  try {
    for (const fileName of completeInstallerSet.slice(0, 2)) {
      await writeFile(join(directory, fileName), 'package');
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

test('the executable --target option validates only one isolated matrix target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-release-target-'));
  const script = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url));

  try {
    await writeFile(join(directory, completeInstallerSet[0]), 'package');
    await writeFile(join(directory, platformSidecars.mac[0]), 'sidecar');
    await writeFile(join(directory, 'builder-effective-config.yaml'), 'metadata');

    const targetResult = spawnSync(
      process.execPath,
      [script, directory, '--target', 'mac-arm64'],
      { encoding: 'utf8' },
    );
    assert.equal(targetResult.status, 0, targetResult.stderr);

    const platformResult = spawnSync(
      process.execPath,
      [script, directory, '--platform', 'mac'],
      { encoding: 'utf8' },
    );
    assert.notEqual(platformResult.status, 0);
    assert.match(platformResult.stderr, /mac-x64\.dmg/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the executable rejects zero-byte and non-regular expected artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-release-invalid-'));
  const script = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url));

  try {
    await writeFile(join(directory, completeInstallerSet[0]), '');
    await mkdir(join(directory, completeInstallerSet[1]));

    const result = spawnSync(process.execPath, [script, directory, '--platform', 'mac'], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Codex-Pet-Pause-0\.2\.0-mac-arm64\.dmg/);
    assert.match(result.stderr, /Codex-Pet-Pause-0\.2\.0-mac-x64\.dmg/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the executable rejects an unexpected zero-byte stale package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-release-stale-'));
  const script = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url));

  try {
    for (const fileName of completeInstallerSet.slice(0, 2)) {
      await writeFile(join(directory, fileName), 'package');
    }
    await writeFile(join(directory, 'Codex-Pet-Pause-0.1.0-mac-x64.dmg'), '');

    const result = spawnSync(process.execPath, [script, directory, '--platform', 'mac'], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected release artifact: Codex-Pet-Pause-0\.1\.0-mac-x64\.dmg/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
