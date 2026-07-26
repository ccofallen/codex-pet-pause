import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAll } from '@electron/asar';
import { verifyPackagedResources } from './verify-packaged-resources.mjs';

async function findAppArchives(directory) {
  const archives = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      archives.push(...await findAppArchives(entryPath));
    } else if (entry.isFile() && entry.name === 'app.asar') {
      archives.push(entryPath);
    }
  }
  return archives;
}

export async function verifyPackagedApp(directory) {
  const packageDirectory = resolve(directory);
  const archives = await findAppArchives(packageDirectory);
  if (archives.length !== 1) {
    return [`Expected exactly one app.asar in ${packageDirectory}, found ${archives.length}`];
  }

  const extractionDirectory = await mkdtemp(join(tmpdir(), 'codex-pet-asar-'));
  try {
    extractAll(archives[0], extractionDirectory);
    return await verifyPackagedResources(join(extractionDirectory, 'dist'));
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-packaged-app.mjs <package-output-directory>');
  }
  const failures = await verifyPackagedApp(process.argv[2]);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Packaged app.asar resources resolve inside packaged dist.');
}
