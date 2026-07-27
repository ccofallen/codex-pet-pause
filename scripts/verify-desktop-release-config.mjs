import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const expected = {
  appId: 'io.elevenlabs.codexpetpause',
  productName: 'Codex Pet Pause',
  macIcon: 'build/icons/icon.icns',
  winIcon: 'build/icons/icon.ico',
  linuxIcon: 'build/icons/png',
  macArtifactName: 'Codex-Pet-Pause-${version}-mac-${arch}.${ext}',
  winArtifactName: 'Codex-Pet-Pause-${version}-windows-${arch}.${ext}',
  linuxArtifactName: 'Codex-Pet-Pause-${version}-linux-${arch}.${ext}',
};

function targetEntriesFor(platform, target) {
  return (platform?.target ?? []).filter((entry) => entry.target === target);
}

function hasExactlyArchitectures(architectures, expectedArchitectures) {
  return Array.isArray(architectures)
    && architectures.length === expectedArchitectures.length
    && new Set(architectures).size === expectedArchitectures.length
    && expectedArchitectures.every((architecture) => architectures.includes(architecture));
}

export function verifyDesktopReleaseConfig(packageJson, fileExists = existsSync) {
  const failures = [];
  const build = packageJson.build ?? {};
  if (build.appId !== expected.appId) failures.push(`appId must be ${expected.appId}`);
  if (build.productName !== expected.productName) failures.push(`productName must be ${expected.productName}`);

  const macTargetEntries = build.mac?.target ?? [];
  const macDmgEntries = targetEntriesFor(build.mac, 'dmg');
  if (macTargetEntries.length !== 1 || macDmgEntries.length !== 1) {
    failures.push('macOS targets must be exactly dmg');
    failures.push('macOS targets must be exactly one dmg entry');
  }
  if (!hasExactlyArchitectures(macDmgEntries[0]?.arch, ['arm64', 'x64'])) {
    failures.push('macOS DMG must target exactly arm64 and x64');
  }
  const winTargetEntries = build.win?.target ?? [];
  const winNsisEntries = targetEntriesFor(build.win, 'nsis');
  if (winTargetEntries.length !== 1 || winNsisEntries.length !== 1) {
    failures.push('Windows targets must be exactly nsis');
    failures.push('Windows targets must be exactly one nsis entry');
  }
  if (!hasExactlyArchitectures(winNsisEntries[0]?.arch, ['x64'])) {
    failures.push('Windows NSIS must target exactly x64');
  }
  const linuxTargetEntries = build.linux?.target ?? [];
  const linuxAppImageEntries = targetEntriesFor(build.linux, 'AppImage');
  const linuxDebEntries = targetEntriesFor(build.linux, 'deb');
  if (
    linuxTargetEntries.length !== 2 ||
    linuxAppImageEntries.length !== 1 ||
    linuxDebEntries.length !== 1
  ) {
    failures.push('Linux targets must be exactly AppImage and deb');
    failures.push('Linux targets must be exactly one AppImage entry and one deb entry');
  }
  if (!hasExactlyArchitectures(linuxAppImageEntries[0]?.arch, ['x64'])) {
    failures.push('Linux AppImage must target exactly x64');
  }
  if (!hasExactlyArchitectures(linuxDebEntries[0]?.arch, ['x64'])) {
    failures.push('Linux DEB must target exactly x64');
  }

  for (const [label, platform, artifactName] of [
    ['macOS artifact name', 'mac', expected.macArtifactName],
    ['Windows artifact name', 'win', expected.winArtifactName],
    ['Linux artifact name', 'linux', expected.linuxArtifactName],
  ]) {
    if (build[platform]?.artifactName !== artifactName) {
      failures.push(`${label} must be ${artifactName}`);
    }
  }

  for (const [label, platform, icon] of [
    ['macOS icon', 'mac', expected.macIcon],
    ['Windows icon', 'win', expected.winIcon],
    ['Linux icon', 'linux', expected.linuxIcon],
  ]) {
    if (build[platform]?.icon !== icon) failures.push(`${label} must be configured as ${icon}`);
    if (!fileExists(icon)) failures.push(`${label} is missing: ${icon}`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const failures = verifyDesktopReleaseConfig(packageJson, (entry) => existsSync(`${root}${entry}`));
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Desktop release configuration is valid.');
}
