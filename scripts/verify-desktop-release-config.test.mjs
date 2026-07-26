import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDesktopReleaseConfig } from './verify-desktop-release-config.mjs';

const validPackage = {
  build: {
    appId: 'io.elevenlabs.codexpetpause',
    productName: 'Codex Pet Pause',
    mac: {
      icon: 'build/icons/icon.icns',
      target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
      artifactName: 'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
    },
    win: {
      icon: 'build/icons/icon.ico',
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: 'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
    },
    linux: {
      icon: 'build/icons/png',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      artifactName: 'Codex-Pet-Pause-${version}-linux-${arch}.${ext}',
    },
  },
};

test('accepts the approved desktop release contract', () => {
  const failures = verifyDesktopReleaseConfig(validPackage, () => true);
  assert.deepEqual(failures, []);
});

test('rejects an identity, target, or icon regression', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.appId = 'example.changed';
  invalid.build.win.target = [{ target: 'portable', arch: ['x64'] }];
  const failures = verifyDesktopReleaseConfig(invalid, () => false);
  assert.ok(failures.some((failure) => failure.includes('appId')));
  assert.ok(failures.some((failure) => failure.includes('NSIS')));
  assert.ok(failures.some((failure) => failure.includes('icon')));
});
