import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const releaseDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const forbiddenRepositoryFiles = [
  fileURLToPath(new URL('../scripts/generate-meow.mjs', import.meta.url)),
];
const forbiddenMarker = '__NEKO_TEST_NOW__';

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
}

const releaseFiles = await filesBelow(releaseDirectory);
const releaseAudio = releaseFiles.filter((file) => file.endsWith('/assets/cat/meow.wav'));
const approvedProvenancePath = fileURLToPath(new URL(
  '../docs/ASSET-PROVENANCE.md',
  import.meta.url,
));
if (releaseAudio.length !== 1) {
  throw new Error(`Expected exactly one approved cat sound; found ${releaseAudio.length}`);
}
if (!existsSync(approvedProvenancePath)) {
  throw new Error('Approved cat sound provenance is missing');
}
const approvedProvenance = await readFile(approvedProvenancePath, 'utf8');
const checksumMatch = approvedProvenance.match(/^- Approved SHA-256: ([a-f0-9]{64})$/m);
if (checksumMatch === null) {
  throw new Error('Approved cat sound checksum is missing from provenance');
}
const releaseChecksum = createHash('sha256').update(await readFile(releaseAudio[0])).digest('hex');
if (releaseChecksum !== checksumMatch[1]) {
  throw new Error(`Approved cat sound checksum mismatch: ${releaseChecksum}`);
}

for (const file of forbiddenRepositoryFiles) {
  if (existsSync(file)) throw new Error(`Synthetic cat audio generator remains: ${file}`);
}

const contaminated = [];
for (const file of releaseFiles) {
  const contents = await readFile(file);
  if (contents.includes(forbiddenMarker)) contaminated.push(file);
}

if (contaminated.length > 0) {
  throw new Error(`Release dist contains the E2E clock marker:\n${contaminated.join('\n')}`);
}

console.log(`Release dist is free of ${forbiddenMarker} (${releaseFiles.length} files checked).`);
