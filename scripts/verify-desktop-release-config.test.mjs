import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDesktopReleaseConfig } from './verify-desktop-release-config.mjs';

const validPackage = {
  author: {
    name: 'ccofallen',
    email: 'ccofallen@users.noreply.github.com',
  },
  scripts: {
    'desktop:pack': 'npm run desktop:build && electron-builder --publish=never',
    'desktop:pack:mac': 'npm run desktop:pack -- --mac --arm64 --x64',
  },
  build: {
    appId: 'io.elevenlabs.codexpetpause',
    productName: 'Codex Pet Pause',
    afterPack: 'scripts/after-pack.mjs',
    mac: {
      icon: 'build/icons/icon.icns',
      target: [{ target: 'dmg' }],
      artifactName: 'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
    },
    win: {
      icon: 'build/icons/icon.ico',
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: 'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
    },
    linux: {
      icon: 'build/icons/png',
      maintainer: 'ccofallen <ccofallen@users.noreply.github.com>',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      artifactName: 'Codex-Pet-Pause-${version}-linux-x64.${ext}',
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
    'Codex-Pet-Pause-${version}-linux-x64.${ext}',
  );
});

test('requires the ARM64 signing repair hook', () => {
  const missingHook = structuredClone(validPackage);
  delete missingHook.build.afterPack;

  assert.ok(
    verifyDesktopReleaseConfig(missingHook, () => true)
      .some((failure) => failure.includes('afterPack')),
  );
});

test('requires the approved privacy-preserving Linux maintainer identity', () => {
  const missingAuthorEmail = structuredClone(validPackage);
  delete missingAuthorEmail.author.email;
  const missingMaintainer = structuredClone(validPackage);
  delete missingMaintainer.build.linux.maintainer;
  const invalidMaintainer = structuredClone(validPackage);
  invalidMaintainer.build.linux.maintainer = 'ccofallen';

  assert.ok(
    verifyDesktopReleaseConfig(missingAuthorEmail, () => true)
      .some((failure) => failure.includes('author')),
  );
  assert.ok(
    verifyDesktopReleaseConfig(missingMaintainer, () => true)
      .some((failure) => failure.includes('Linux maintainer')),
  );
  assert.ok(
    verifyDesktopReleaseConfig(invalidMaintainer, () => true)
      .some((failure) => failure.includes('Linux maintainer')),
  );
});

test('keeps mac config architecture-neutral and the local mac command explicitly dual-arch', () => {
  const embeddedArchitectures = structuredClone(validPackage);
  embeddedArchitectures.build.mac.target[0].arch = ['arm64', 'x64'];
  const ambiguousLocalCommand = structuredClone(validPackage);
  ambiguousLocalCommand.scripts['desktop:pack:mac'] = 'npm run desktop:pack -- --mac';

  assert.ok(
    verifyDesktopReleaseConfig(embeddedArchitectures, () => true)
      .some((failure) => failure.includes('macOS architecture must be selected by the command')),
  );
  assert.ok(
    verifyDesktopReleaseConfig(ambiguousLocalCommand, () => true)
      .some((failure) => failure.includes('local mac package command')),
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
  invalid.build.linux.artifactName = 'Codex-Pet-Pause-${version}-linux-${arch}.${ext}';
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

test('rejects unsupported or duplicate target architectures', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.mac.target[0].arch = ['arm64'];
  invalid.build.win.target[0].arch.push('arm64');
  invalid.build.linux.target[0].arch.push('arm64');
  invalid.build.linux.target[1].arch.push('x64');
  const failures = verifyDesktopReleaseConfig(invalid, () => true);
  assert.ok(failures.some((failure) => failure.includes('macOS architecture must be selected by the command')));
  assert.ok(failures.some((failure) => failure.includes('Windows NSIS must target exactly x64')));
  assert.ok(failures.some((failure) => failure.includes('Linux AppImage must target exactly x64')));
  assert.ok(failures.some((failure) => failure.includes('Linux DEB must target exactly x64')));
});

test('rejects duplicate expected target definitions', () => {
  const invalid = structuredClone(validPackage);
  invalid.build.mac.target.push({ target: 'dmg' });
  invalid.build.win.target.push({ target: 'nsis', arch: ['x64'] });
  invalid.build.linux.target.push({ target: 'AppImage', arch: ['x64'] });
  const failures = verifyDesktopReleaseConfig(invalid, () => true);
  assert.ok(failures.some((failure) => failure.includes('macOS targets must be exactly one dmg entry')));
  assert.ok(failures.some((failure) => failure.includes('Windows targets must be exactly one nsis entry')));
  assert.ok(failures.some((failure) => failure.includes('Linux targets must be exactly one AppImage entry and one deb entry')));
});

test('accepts approved target entries in any order', () => {
  const reordered = structuredClone(validPackage);
  reordered.build.linux.target.reverse();
  const failures = verifyDesktopReleaseConfig(reordered, () => true);
  assert.deepEqual(failures, []);
});
