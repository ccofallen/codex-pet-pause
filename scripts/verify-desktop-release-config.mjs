import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const expected = {
  appId: 'io.elevenlabs.codexpetpause',
  productName: 'Codex Pet Pause',
  macIcon: 'build/icons/icon.icns',
  winIcon: 'build/icons/icon.ico',
  linuxIcon: 'build/icons/png',
};

function targetsFor(platform) {
  return new Map(
    (platform?.target ?? []).map(({ target, arch }) => [target, arch ?? []]),
  );
}

export function verifyDesktopReleaseConfig(packageJson, fileExists = existsSync) {
  const failures = [];
  const build = packageJson.build ?? {};
  if (build.appId !== expected.appId) failures.push(`appId must be ${expected.appId}`);
  if (build.productName !== expected.productName) failures.push(`productName must be ${expected.productName}`);

  const macTargets = targetsFor(build.mac);
  if (macTargets.size !== 1 || !macTargets.has('dmg')) {
    failures.push('macOS targets must be exactly dmg');
  }
  if (!macTargets.get('dmg')?.includes('arm64') || !macTargets.get('dmg')?.includes('x64')) {
    failures.push('macOS DMG must target arm64 and x64');
  }
  const winTargets = targetsFor(build.win);
  if (winTargets.size !== 1 || !winTargets.has('nsis')) {
    failures.push('Windows targets must be exactly nsis');
  }
  if (!winTargets.get('nsis')?.includes('x64')) failures.push('Windows NSIS must target x64');
  const linuxTargets = targetsFor(build.linux);
  if (
    linuxTargets.size !== 2 ||
    !linuxTargets.has('AppImage') ||
    !linuxTargets.has('deb')
  ) {
    failures.push('Linux targets must be exactly AppImage and deb');
  }
  if (!linuxTargets.get('AppImage')?.includes('x64')) failures.push('Linux AppImage must target x64');
  if (!linuxTargets.get('deb')?.includes('x64')) failures.push('Linux DEB must target x64');

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
