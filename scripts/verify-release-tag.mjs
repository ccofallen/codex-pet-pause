import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function verifyReleaseTag(tag, version) {
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`Expected release tag ${expectedTag}, received ${tag ?? '<missing>'}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-release-tag.mjs <tag>');
  }
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  verifyReleaseTag(process.argv[2], packageJson.version);
  console.log(`Release tag matches package version ${packageJson.version}.`);
}
