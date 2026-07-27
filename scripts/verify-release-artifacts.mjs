import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const supportedPlatforms = new Set(['all', 'mac', 'windows', 'linux']);
const supportedTargets = new Set(['mac-arm64', 'mac-x64', 'windows-x64', 'linux-x64']);
const targetPlatforms = {
  'mac-arm64': 'mac',
  'mac-x64': 'mac',
  'windows-x64': 'windows',
  'linux-x64': 'linux',
};
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
      target: 'mac-arm64',
      fileName: `Codex-Pet-Pause-${version}-mac-arm64.dmg`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-mac-arm64\\.dmg$`),
    },
    {
      platform: 'mac',
      target: 'mac-x64',
      fileName: `Codex-Pet-Pause-${version}-mac-x64.dmg`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-mac-x64\\.dmg$`),
    },
    {
      platform: 'windows',
      target: 'windows-x64',
      fileName: `Codex-Pet-Pause-${version}-windows-x64.exe`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-windows-x64\\.exe$`),
    },
    {
      platform: 'linux',
      target: 'linux-x64',
      fileName: `Codex-Pet-Pause-${version}-linux-x64.AppImage`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-linux-x64\\.AppImage$`),
    },
    {
      platform: 'linux',
      target: 'linux-x64',
      fileName: `Codex-Pet-Pause-${version}-linux-x64.deb`,
      pattern: new RegExp(`^Codex-Pet-Pause-${escapedVersion}-linux-x64\\.deb$`),
    },
  ];
}

function expectedSidecars(version) {
  return [
    {
      platform: 'mac',
      target: 'mac-arm64',
      fileName: `Codex-Pet-Pause-${version}-mac-arm64.dmg.blockmap`,
    },
    {
      platform: 'mac',
      target: 'mac-x64',
      fileName: `Codex-Pet-Pause-${version}-mac-x64.dmg.blockmap`,
    },
    {
      platform: 'windows',
      target: 'windows-x64',
      fileName: `Codex-Pet-Pause-${version}-windows-x64.exe.blockmap`,
    },
  ];
}

export function verifyReleaseArtifacts(fileNames, version, scope = 'all') {
  if (!supportedPlatforms.has(scope) && !supportedTargets.has(scope)) {
    throw new Error(`Unsupported release scope: ${scope}`);
  }

  const target = supportedTargets.has(scope) ? scope : undefined;
  const platform = target === undefined ? scope : targetPlatforms[target];
  const entries = fileNames.map((entry) => (
    typeof entry === 'string'
      ? { name: entry, isFile: true, size: 1 }
      : entry
  ));
  const expected = expectedArtifacts(version)
    .filter((artifact) => (
      scope === 'all'
      || (target === undefined ? artifact.platform === platform : artifact.target === target)
    ));
  const expectedNames = new Set(expected.map((artifact) => artifact.fileName));
  const allowedMetadata = new Set(
    scope === 'all'
      ? []
      : [
        ...commonBuilderMetadata,
        ...platformBuilderMetadata[platform],
        ...expectedSidecars(version)
          .filter((sidecar) => (
            target === undefined ? sidecar.platform === platform : sidecar.target === target
          ))
          .map((sidecar) => sidecar.fileName),
      ],
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
  if (args.length === 1) return { directory: args[0], scope: 'all' };
  if (
    args.length === 3
    && args[1] === '--platform'
    && supportedPlatforms.has(args[2])
    && args[2] !== 'all'
  ) {
    return { directory: args[0], scope: args[2] };
  }
  if (
    args.length === 3
    && args[1] === '--target'
    && supportedTargets.has(args[2])
  ) {
    return { directory: args[0], scope: args[2] };
  }
  throw new Error(
    'Usage: node scripts/verify-release-artifacts.mjs <directory> '
    + '[--platform mac|windows|linux | --target mac-arm64|mac-x64|windows-x64|linux-x64]',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { directory, scope } = parseArguments(process.argv.slice(2));
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
  const failures = verifyReleaseArtifacts(fileNames, packageJson.version, scope);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(`Release artifacts are valid for ${scope}.`);
}
