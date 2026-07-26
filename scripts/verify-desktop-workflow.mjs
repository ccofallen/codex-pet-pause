import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const expectedPackages = [
  ['mac-arm64', 'mac', 'macos-latest', 'npm run desktop:pack:mac -- --arm64', 'release/*-mac-arm64.dmg'],
  ['mac-x64', 'mac', 'macos-latest', 'npm run desktop:pack:mac -- --x64', 'release/*-mac-x64.dmg'],
  ['windows-x64', 'windows', 'windows-latest', 'npm run desktop:pack:win -- --x64', 'release/*-windows-x64.exe'],
  ['linux-x64', 'linux', 'ubuntu-latest', 'npm run desktop:pack:linux -- --x64', 'release/*-linux-x64.AppImage\nrelease/*-linux-x64.deb\n'],
];
const actionlintRun = 'docker run --rm -v "$GITHUB_WORKSPACE:/workspace" -w /workspace rhysd/actionlint:1.7.12 .github/workflows/build-desktop.yml';
const tagPushCondition = "github.event_name=='push'&&startsWith(github.ref,'refs/tags/v')";
const packageArtifactValidationRun = 'node scripts/verify-release-artifacts.mjs release --platform ${{ matrix.platform }}';
const releaseArtifactValidationRun = 'node scripts/verify-release-artifacts.mjs release-assets';

function hasNeed(job, expectedNeed) {
  const needs = job?.needs;
  return Array.isArray(needs) ? needs.includes(expectedNeed) : needs === expectedNeed;
}

function hasRun(job, command) {
  return job?.steps?.some((step) => step.run === command);
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
  if (!hasRun(jobs.validate, 'npm ci')) failures.push('validate job must run npm ci');
  const actionlint = jobs.validate?.steps?.find(
    (step) => step.name === 'Validate workflow syntax with actionlint',
  );
  if (actionlint?.run !== actionlintRun) {
    failures.push('validate job must invoke pinned actionlint with only a workflow path argument');
  }

  if (!hasNeed(jobs.package, 'validate')) failures.push('package job must depend on validate');
  const packageCondition = jobs.package?.if?.replaceAll(/\s+/g, '');
  if (packageCondition !== tagPushCondition) {
    failures.push('package job must run only for v* tag pushes');
  }
  if (!hasRun(jobs.package, 'npm ci')) failures.push('package job must run npm ci');
  if (!hasRun(jobs.package, '${{ matrix.command }}')) {
    failures.push('package job must run the matrix command');
  }

  const packages = jobs.package?.strategy?.matrix?.include;
  if (!Array.isArray(packages) || packages.length !== expectedPackages.length) {
    failures.push('package matrix must contain exactly four native targets');
  }
  for (const [id, platform, os, command, artifact] of expectedPackages) {
    const entry = packages?.find((candidate) => candidate.id === id);
    if (!entry) {
      failures.push(`package matrix is missing ${id}`);
      continue;
    }
    if (entry.platform !== platform) {
      failures.push(`${id} validator platform must be ${platform}`);
    }
    if (entry.os !== os) failures.push(`${id} must run on ${os}`);
    if (entry.command !== command) failures.push(`${id} command must be ${command}`);
    if (entry.artifact !== artifact) failures.push(`${id} must publish ${artifact.trim()}`);
  }
  const packageSteps = jobs.package?.steps ?? [];
  const matrixCommandIndex = packageSteps.findIndex((step) => step.run === '${{ matrix.command }}');
  const packageValidationIndexes = packageSteps
    .map((step, index) => step.run === packageArtifactValidationRun ? index : -1)
    .filter((index) => index >= 0);
  const artifactUpload = jobs.package?.steps?.find(
    (step) => step.uses === 'actions/upload-artifact@v4',
  );
  const artifactUploadIndex = packageSteps.indexOf(artifactUpload);
  if (packageValidationIndexes.length !== 1) {
    failures.push('package job must validate matrix artifacts exactly once');
  } else if (
    packageValidationIndexes[0] <= matrixCommandIndex
    || packageValidationIndexes[0] >= artifactUploadIndex
  ) {
    failures.push('package artifact validation must run after the matrix command and before upload');
  }
  if (artifactUpload?.with?.path !== '${{ matrix.artifact }}') {
    failures.push('package artifact upload must use the matrix artifact path');
  }
  if (artifactUpload?.with?.['if-no-files-found'] !== 'error') {
    failures.push('package artifact upload must set if-no-files-found to error');
  }

  if (!hasNeed(jobs.release, 'package')) failures.push('release job must depend on the package job');
  const releaseCondition = jobs.release?.if?.replaceAll(/\s+/g, '');
  if (releaseCondition !== tagPushCondition) {
    failures.push('release job must run only for v* tag pushes');
  }
  const releaseSteps = jobs.release?.steps ?? [];
  const checkoutIndex = releaseSteps.findIndex((step) => step.uses === 'actions/checkout@v4');
  const downloadIndex = releaseSteps.findIndex(
    (step) => step.uses === 'actions/download-artifact@v4',
  );
  const download = releaseSteps[downloadIndex];
  const releaseValidationIndexes = releaseSteps
    .map((step, index) => step.run === releaseArtifactValidationRun ? index : -1)
    .filter((index) => index >= 0);
  const publishIndex = releaseSteps.findIndex((step) => step.name === 'Publish release assets');
  if (checkoutIndex < 0) failures.push('release job must check out the validator source');
  if (download?.with?.path !== 'release-assets') {
    failures.push('release download must use release-assets');
  }
  if (download?.with?.['merge-multiple'] !== true) {
    failures.push('release download must merge artifacts into one directory');
  }
  if (releaseValidationIndexes.length !== 1) {
    failures.push('release job must validate the complete artifact set exactly once');
  } else if (
    releaseValidationIndexes[0] <= downloadIndex
    || releaseValidationIndexes[0] >= publishIndex
  ) {
    failures.push('release artifact validation must run after download and before publishing');
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
