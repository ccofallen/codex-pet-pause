import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const supportedPlatforms = new Set(['all', 'mac', 'windows', 'linux']);

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

  return expectedArtifacts(version)
    .filter((artifact) => platform === 'all' || artifact.platform === platform)
    .filter((artifact) => !fileNames.some((fileName) => artifact.pattern.test(fileName)))
    .map((artifact) => `Missing release artifact: ${artifact.fileName}`);
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
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const failures = verifyReleaseArtifacts(fileNames, packageJson.version, platform);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(`Release artifacts are valid for ${platform}.`);
}
