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
  assert.equal(
    validPackage.build.mac.artifactName,
    'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
  );
  assert.equal(
    validPackage.build.win.artifactName,
    'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
  );
  assert.equal(
    validPackage.build.linux.artifactName,
    'Codex-Pet-Pause-${version}-linux-${arch}.${ext}',
  );
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

test('rejects wrong configured native icon paths even when expected files exist', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.mac.icon = 'build/icons/wrong.icns';
  invalid.build.win.icon = 'build/icons/wrong.ico';
  invalid.build.linux.icon = 'build/icons/wrong-png';
  const failures = verifyDesktopReleaseConfig(invalid, () => true);
  assert.ok(failures.some((failure) => failure.includes('macOS icon must be configured as build/icons/icon.icns')));
  assert.ok(failures.some((failure) => failure.includes('Windows icon must be configured as build/icons/icon.ico')));
  assert.ok(failures.some((failure) => failure.includes('Linux icon must be configured as build/icons/png')));
});

test('rejects artifact names that differ from the release contract', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.mac.artifactName = 'Codex-Pet-Pause-${version}-mac.${ext}';
  invalid.build.win.artifactName = 'Codex-Pet-Pause-${version}-win-${arch}.${ext}';
  invalid.build.linux.artifactName = 'Codex-Pet-Pause-${version}-linux-${version}.${ext}';
  const failures = verifyDesktopReleaseConfig(invalid, () => true);
  assert.ok(failures.some((failure) => failure.includes('macOS artifact name')));
  assert.ok(failures.some((failure) => failure.includes('Windows artifact name')));
  assert.ok(failures.some((failure) => failure.includes('Linux artifact name')));
});

test('rejects unintended extra target formats on every platform', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.mac.target.push({ target: 'zip', arch: ['arm64', 'x64'] });
  invalid.build.win.target.push({ target: 'nsis-web', arch: ['x64'] });
  invalid.build.linux.target.push({ target: 'snap', arch: ['x64'] });
  const failures = verifyDesktopReleaseConfig(invalid, () => true);
  assert.ok(failures.some((failure) => failure.includes('macOS targets must be exactly dmg')));
  assert.ok(failures.some((failure) => failure.includes('Windows targets must be exactly nsis')));
  assert.ok(failures.some((failure) => failure.includes('Linux targets must be exactly AppImage and deb')));
});
