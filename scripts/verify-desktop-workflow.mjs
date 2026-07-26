import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const expectedPackages = [
  ['mac-arm64', 'macos-latest', 'release/*-mac-arm64.dmg'],
  ['mac-x64', 'macos-latest', 'release/*-mac-x64.dmg'],
  ['windows-x64', 'windows-latest', 'release/*-windows-x64.exe'],
  ['linux-x64', 'ubuntu-latest', 'release/*-linux-x64.AppImage\nrelease/*-linux-x64.deb\n'],
];

function hasNeed(job, expectedNeed) {
  const needs = job?.needs;
  return Array.isArray(needs) ? needs.includes(expectedNeed) : needs === expectedNeed;
}

export function verifyDesktopWorkflow(workflow) {
  const failures = [];
  const push = workflow?.on?.push;
  if (!push?.branches?.includes('main')) failures.push('pushes must include main');
  if (!push?.tags?.includes('v*')) failures.push('pushes must include v* tags');
  if (workflow?.on?.pull_request === undefined) failures.push('pull requests must trigger the workflow');
  if (workflow?.on?.workflow_dispatch === undefined) {
    failures.push('workflow dispatch must trigger the workflow');
  }
  if (workflow?.permissions?.contents !== 'write') {
    failures.push('workflow permissions must allow writing release contents');
  }

  const jobs = workflow?.jobs ?? {};
  if (!jobs.validate) failures.push('validate job is required');
  if (!hasNeed(jobs.package, 'validate')) failures.push('package job must depend on validate');

  const packages = jobs.package?.strategy?.matrix?.include;
  if (!Array.isArray(packages) || packages.length !== expectedPackages.length) {
    failures.push('package matrix must contain exactly four native targets');
  }
  for (const [id, os, artifact] of expectedPackages) {
    const entry = packages?.find((candidate) => candidate.id === id);
    if (!entry) {
      failures.push(`package matrix is missing ${id}`);
      continue;
    }
    if (entry.os !== os) failures.push(`${id} must run on ${os}`);
    if (entry.artifact !== artifact) failures.push(`${id} must publish ${artifact.trim()}`);
  }

  if (!hasNeed(jobs.release, 'package')) failures.push('release job must depend on the package job');
  const releaseCondition = jobs.release?.if?.replaceAll(/\s+/g, '');
  if (releaseCondition !== "github.ref_type=='tag'&&startsWith(github.ref,'refs/tags/v')") {
    failures.push('release job must run only for v* tags');
  }

  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workflowUrl = new URL('../.github/workflows/build-desktop.yml', import.meta.url);
  const workflow = parse(await readFile(workflowUrl, 'utf8'));
  const failures = verifyDesktopWorkflow(workflow);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log('Desktop release workflow is valid.');
}
