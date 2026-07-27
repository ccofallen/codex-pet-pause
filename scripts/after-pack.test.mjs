import assert from 'node:assert/strict';
import test from 'node:test';
import { Arch } from 'builder-util';
import { afterPack } from './after-pack.mjs';

function context(electronPlatformName, arch) {
  return {
    electronPlatformName,
    arch,
    appOutDir: '/tmp/codex-pet-output',
    packager: {
      appInfo: {
        productFilename: 'Codex Pet Pause',
      },
    },
  };
}

test('deep-signs only the unpacked macOS ARM64 application', async () => {
  const calls = [];
  const execFile = async (...args) => {
    calls.push(args);
  };

  await afterPack(context('darwin', Arch.arm64), { execFile });

  assert.deepEqual(calls, [
    ['xattr', ['-cr', '/tmp/codex-pet-output/Codex Pet Pause.app']],
    [
      'codesign',
      ['--force', '--deep', '--sign', '-', '/tmp/codex-pet-output/Codex Pet Pause.app'],
    ],
  ]);
});

test('does not change macOS x64, Windows, or Linux packages', async () => {
  const calls = [];
  const execFile = async (...args) => {
    calls.push(args);
  };

  await afterPack(context('darwin', Arch.x64), { execFile });
  await afterPack(context('win32', Arch.x64), { execFile });
  await afterPack(context('linux', Arch.x64), { execFile });

  assert.deepEqual(calls, []);
});
