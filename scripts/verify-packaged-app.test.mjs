import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';

const script = fileURLToPath(new URL('./verify-packaged-app.mjs', import.meta.url));

test('declares and locks the ASAR API as a direct compatible dev dependency', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(packageJson.devDependencies['@electron/asar'], '^3.4.1');
  assert.equal(packageLock.packages[''].devDependencies['@electron/asar'], '^3.4.1');
  assert.equal(packageLock.packages['node_modules/@electron/asar'].version, '3.4.1');
});

async function createPackagedApp(html) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-app-asar-'));
  const appDirectory = join(directory, 'app');
  const releaseDirectory = join(directory, 'release');
  const resourceDirectory = join(releaseDirectory, 'native-output', 'resources');
  await mkdir(join(appDirectory, 'dist', 'assets'), { recursive: true });
  await mkdir(resourceDirectory, { recursive: true });
  await writeFile(join(appDirectory, 'dist', 'assets', 'app.js'), 'console.log("asar");');
  await writeFile(join(appDirectory, 'dist', 'index.html'), html);
  await createPackage(appDirectory, join(resourceDirectory, 'app.asar'));
  return { directory, releaseDirectory };
}

test('extracts and validates resources from the actual packaged app.asar', async () => {
  const fixture = await createPackagedApp(
    '<!doctype html><script type="module" src="./assets/app.js"></script>',
  );
  try {
    const result = spawnSync(
      process.execPath,
      [script, fixture.releaseDirectory],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rejects packaged app.asar resources that escape packaged dist', async () => {
  const fixture = await createPackagedApp(
    '<!doctype html><script type="module" src="/assets/app.js"></script>',
  );
  try {
    const result = spawnSync(
      process.execPath,
      [script, fixture.releaseDirectory],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /resolves outside packaged dist/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rejects a package output without exactly one app.asar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-no-asar-'));
  try {
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one app\.asar/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
