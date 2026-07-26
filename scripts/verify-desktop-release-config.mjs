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
  if (!macTargets.get('dmg')?.includes('arm64') || !macTargets.get('dmg')?.includes('x64')) {
    failures.push('macOS DMG must target arm64 and x64');
  }
  const winTargets = targetsFor(build.win);
  if (!winTargets.get('nsis')?.includes('x64')) failures.push('Windows NSIS must target x64');
  const linuxTargets = targetsFor(build.linux);
  if (!linuxTargets.get('AppImage')?.includes('x64')) failures.push('Linux AppImage must target x64');
  if (!linuxTargets.get('deb')?.includes('x64')) failures.push('Linux DEB must target x64');

  for (const [label, icon] of [
    ['macOS icon', expected.macIcon],
    ['Windows icon', expected.winIcon],
    ['Linux icon', expected.linuxIcon],
  ]) {
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
