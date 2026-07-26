import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const supportedPlatforms = new Set(['all', 'mac', 'windows', 'linux']);
const commonBuilderMetadata = ['builder-debug.yml', 'builder-effective-config.yaml'];
const platformBuilderMetadata = {
  mac: ['latest-mac.yml'],
  windows: ['latest.yml'],
  linux: ['latest-linux.yml'],
};

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectedArtifacts(version) {
  const escapedVersion = escapeRegularExpression(version);
  return [
    {
      platform: 'mac',
      fileName: `Codex-Pet-Pause-${version}-mac-arm64.dmg`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-mac-arm64\\.dmg$`),
    },
    {
      platform: 'mac',
      fileName: `Codex-Pet-Pause-${version}-mac-x64.dmg`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-mac-x64\\.dmg$`),
    },
    {
      platform: 'windows',
      fileName: `Codex-Pet-Pause-${version}-windows-x64.exe`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-windows-x64\\.exe$`),
    },
    {
      platform: 'linux',
      fileName: `Codex-Pet-Pause-${version}-linux-x64.AppImage`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-linux-x64\\.AppImage$`),
    },
    {
      platform: 'linux',
      fileName: `Codex-Pet-Pause-${version}-linux-x64.deb`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-linux-x64\\.deb$`),
    },
  ];
}

export function verifyReleaseArtifacts(fileNames, version, platform = 'all') {
  if (!supportedPlatforms.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const entries = fileNames.map((entry) => (
    typeof entry === 'string'
      ? { name: entry, isFile: true, size: 1 }
      : entry
  ));
  const expected = expectedArtifacts(version)
    .filter((artifact) => platform === 'all' || artifact.platform === platform);
  const expectedNames = new Set(expected.map((artifact) => artifact.fileName));
  const allowedMetadata = new Set(
    platform === 'all'
      ? []
      : [...commonBuilderMetadata, ...platformBuilderMetadata[platform]],
  );
  const failures = expected
    .filter((artifact) => !entries.some(
      (entry) => entry.name === artifact.fileName && entry.isFile && entry.size > 0,
    ))
    .map((artifact) => `Missing release artifact: ${artifact.fileName}`);

  for (const entry of entries) {
    if (
      entry.isFile
      && !expectedNames.has(entry.name)
      && !allowedMetadata.has(entry.name)
    ) {
      failures.push(`Unexpected release artifact: ${entry.name}`);
    }
  }
  return failures;
}

function parseArguments(args) {
  if (args.length === 1) return { directory: args[0], platform: 'all' };
  if (
    args.length === 3
    && args[1] === '--platform'
    && supportedPlatforms.has(args[2])
    && args[2] !== 'all'
  ) {
    return { directory: args[0], platform: args[2] };
  }
  throw new Error('Usage: node scripts/verify-release-artifacts.mjs <directory> [--platform mac|windows|linux]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { directory, platform } = parseArguments(process.argv.slice(2));
  const entries = await readdir(directory, { withFileTypes: true });
  const fileNames = [];
  for (const entry of entries) {
    const details = await lstat(join(directory, entry.name));
    fileNames.push({
      name: entry.name,
      isFile: details.isFile(),
      size: details.size,
    });
  }
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const failures = verifyReleaseArtifacts(fileNames, packageJson.version, platform);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(`Release artifacts are valid for ${platform}.`);
}
