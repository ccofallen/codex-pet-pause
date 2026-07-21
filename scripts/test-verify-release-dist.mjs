import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const checksum = 'e69e2ae9983517b3b72b99060d8f71e8a9c8165732b0abf2da6c7da85b668143';

const directory = await mkdtemp(join(tmpdir(), 'verify-release-dist-'));
try {
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'docs'), { recursive: true });
  await mkdir(join(directory, 'dist', 'assets', 'cat'), { recursive: true });
  await cp(join(repositoryRoot, 'scripts', 'verify-release-dist.mjs'), join(directory, 'scripts', 'verify-release-dist.mjs'));
  await cp(join(repositoryRoot, 'public', 'assets', 'cat', 'meow.wav'), join(directory, 'dist', 'assets', 'cat', 'meow.wav'));
  await writeFile(join(directory, 'docs', 'ASSET-PROVENANCE.md'), `# Asset provenance\n\n- Approved SHA-256: ${checksum}\n`);

  const result = spawnSync(process.execPath, [join(directory, 'scripts', 'verify-release-dist.mjs')], {
    cwd: directory,
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0 || !output.includes('Release dist is free of __NEKO_TEST_NOW__ (1 files checked).')) {
    throw new Error(`clean public snapshot: expected success, got status ${result.status}: ${output.trim()}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Release-dist public-snapshot regression test passed.');
