import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const verifier = join(repositoryRoot, 'scripts/verify-documentation.mjs');

function createFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'codex-pet-pause-docs-'));
  for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE']) {
    cpSync(join(repositoryRoot, file), join(fixtureRoot, file));
  }
  cpSync(join(repositoryRoot, 'docs'), join(fixtureRoot, 'docs'), { recursive: true });
  cpSync(join(repositoryRoot, '.github'), join(fixtureRoot, '.github'), { recursive: true });
  return fixtureRoot;
}

function appendReferences(fixtureRoot, references) {
  const readme = readFileSync(join(fixtureRoot, 'README.md'), 'utf8');
  writeFileSync(join(fixtureRoot, 'README.md'), `${readme}\n\n${references}`);
}

function runVerifier(fixtureRoot) {
  return spawnSync(process.execPath, [verifier], {
    encoding: 'utf8',
    env: { ...process.env, VERIFY_DOCUMENTATION_ROOT: fixtureRoot },
  });
}

const validReferences = `[valid full][deployment-guide]
[valid collapsed][]
[valid shortcut]

[deployment-guide]: docs/DEPLOYMENT.md
[valid collapsed]: docs/DEPLOYMENT.md
[valid shortcut]: docs/DEPLOYMENT.md
`;

const validFixture = createFixture();
const brokenFixture = createFixture();

try {
  appendReferences(validFixture, validReferences);
  const validResult = runVerifier(validFixture);
  assert.equal(validResult.status, 0, validResult.stderr);

  appendReferences(
    brokenFixture,
    `${validReferences}\n[broken reference][missing-reference]\n[undefined reference][not-defined]\n\n[missing-reference]: does-not-exist.md\n`,
  );
  const result = runVerifier(brokenFixture);

  assert.notEqual(result.status, 0, 'a broken reference-style destination must fail verification');
  assert.match(result.stderr, /README\.md links to missing local file: does-not-exist\.md/);
  assert.match(result.stderr, /README\.md uses undefined reference link: not-defined/);
  assert.doesNotMatch(result.stderr, /README\.md links to missing local file: docs\/DEPLOYMENT\.md/);
  console.log('Documentation reference-link regression test passed.');
} finally {
  rmSync(validFixture, { force: true, recursive: true });
  rmSync(brokenFixture, { force: true, recursive: true });
}
