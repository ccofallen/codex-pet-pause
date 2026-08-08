import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const expectedPackages = [
  ['mac-arm64', 'mac-arm64', 'macos-latest', 'npm run desktop:pack -- --mac --arm64', 'release/*-mac-arm64.dmg'],
  ['mac-x64', 'mac-x64', 'macos-latest', 'npm run desktop:pack -- --mac --x64', 'release/*-mac-x64.dmg'],
  ['windows-x64', 'windows-x64', 'windows-latest', 'npm run desktop:pack:win -- --x64', 'release/*-windows-x64.exe'],
  ['linux-x64', 'linux-x64', 'ubuntu-latest', 'npm run desktop:pack:linux -- --x64', 'release/*-linux-x64.AppImage\nrelease/*-linux-x64.deb\n'],
];
const actionlintRun = 'docker run --rm -v "$GITHUB_WORKSPACE:/workspace" -w /workspace rhysd/actionlint:1.7.12 .github/workflows/build-desktop.yml';
const playwrightInstallRun = 'npx playwright install --with-deps chromium';
const tagPushCondition = "github.event_name=='push'&&startsWith(github.ref,'refs/tags/v')";
const packageArtifactValidationRun = 'node scripts/verify-release-artifacts.mjs release --target ${{ matrix.target }}';
const releaseArtifactValidationRun = 'node scripts/verify-release-artifacts.mjs release-assets';
const tagVersionRun = 'node scripts/verify-release-tag.mjs "${{ github.ref_name }}"';
const coordinatedTagVersionRun = 'node scripts/verify-release-tag.mjs "${{ inputs.release_tag }}"';
const packagedAppSmokeRun = 'npm run desktop:smoke:packaged-app';
const publishRun = 'if gh release view "$GITHUB_REF_NAME"; then\n  gh release view "$GITHUB_REF_NAME" --json assets --jq \'.assets[].name\' | while IFS= read -r asset; do\n    case "$asset" in\n      Codex-Pet-Pause-*-mac-*.dmg|Codex-Pet-Pause-*-windows-*.exe|Codex-Pet-Pause-*-linux-*.AppImage|Codex-Pet-Pause-*-linux-*.deb)\n        gh release delete-asset "$GITHUB_REF_NAME" "$asset" --yes\n        ;;\n    esac\n  done\n  gh release upload "$GITHUB_REF_NAME" release-assets/*\nelse\n  gh release create "$GITHUB_REF_NAME" release-assets/* --generate-notes --title "Codex Pet Pause $GITHUB_REF_NAME"\nfi\n';

const desktopReleaseAssetPatterns = [
  /^Codex-Pet-Pause-.*-mac-.*\.dmg$/u,
  /^Codex-Pet-Pause-.*-windows-.*\.exe$/u,
  /^Codex-Pet-Pause-.*-linux-.*\.AppImage$/u,
  /^Codex-Pet-Pause-.*-linux-.*\.deb$/u,
];

export function desktopReleaseAssetShouldBeDeleted(assetName) {
  return desktopReleaseAssetPatterns.some((pattern) => pattern.test(assetName));
}

function hasNeed(job, expectedNeed) {
  const needs = job?.needs;
  return Array.isArray(needs) ? needs.includes(expectedNeed) : needs === expectedNeed;
}

function hasRun(job, command) {
  return job?.steps?.some((step) => step.run === command);
}

function verifyDesktopProducerWorkflow(workflow) {
  const failures = [];
  const releaseCondition = "inputs.release_tag!=''";
  const push = workflow?.on?.push;
  if (!push?.branches?.includes('main')) failures.push('pushes must include main');
  if (push?.tags !== undefined) failures.push('desktop producer must not run independently for tags');
  if (workflow?.on?.pull_request === undefined) failures.push('pull requests must trigger the workflow');
  if (workflow?.on?.workflow_dispatch === undefined) {
    failures.push('workflow dispatch must trigger the workflow');
  }
  if (workflow?.on?.workflow_call?.inputs?.release_tag === undefined) {
    failures.push('desktop producer must accept a coordinated release_tag input');
  }
  if (workflow?.permissions?.contents !== 'read') {
    failures.push('desktop producer must use read-only repository permissions');
  }

  const jobs = workflow?.jobs ?? {};
  for (const jobName of ['package', 'release']) {
    if (jobs[jobName]?.if?.replaceAll(/\s+/gu, '') !== releaseCondition) {
      failures.push(`${jobName} job must run only for coordinated releases`);
    }
  }
  const allSteps = Object.values(jobs).flatMap((job) => job?.steps ?? []);
  const externalActions = allSteps
    .map((step) => step.uses)
    .filter((uses) => typeof uses === 'string' && !uses.startsWith('./'));
  for (const action of externalActions) {
    if (!/@[a-f0-9]{40}$/u.test(action)) failures.push(`desktop action must be pinned: ${action}`);
  }
  if (allSteps.some((step) => /gh release (?:create|upload|delete)/u.test(step.run ?? ''))) {
    failures.push('desktop producer must never publish GitHub Release assets directly');
  }

  const packageUpload = jobs.package?.steps?.find(
    (step) => step.uses === 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  );
  if (packageUpload?.with?.name !== 'desktop-${{ matrix.id }}') {
    failures.push('desktop matrix artifacts must use the desktop- namespace');
  }

  for (const jobName of ['package', 'release']) {
    const steps = jobs[jobName]?.steps ?? [];
    const tagIndexes = steps
      .map((step, index) => step.run === coordinatedTagVersionRun ? index : -1)
      .filter((index) => index >= 0);
    if (tagIndexes.length !== 1) {
      failures.push(`${jobName} job must verify the coordinated release tag with a portable input expression`);
    }
  }
  const releaseSteps = jobs.release?.steps ?? [];
  const aggregateDownload = releaseSteps.find(
    (step) => step.uses === 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
  );
  if (
    aggregateDownload?.with?.pattern !== 'desktop-*'
    || aggregateDownload.with?.['merge-multiple'] !== true
  ) {
    failures.push('desktop aggregation must download only desktop-* artifacts');
  }
  const validationIndex = releaseSteps.findIndex(
    (step) => step.run === releaseArtifactValidationRun,
  );
  const aggregateUploadIndex = releaseSteps.findIndex(
    (step) => step.name === 'Upload validated desktop release set',
  );
  const aggregateUpload = releaseSteps[aggregateUploadIndex];
  if (
    aggregateUploadIndex <= validationIndex
    || aggregateUpload?.uses !== 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
    || aggregateUpload.with?.name !== 'codex-pet-pause-desktop-${{ inputs.release_tag }}'
    || aggregateUpload.with?.path !== 'release-assets/'
    || aggregateUpload.with?.['if-no-files-found'] !== 'error'
  ) {
    failures.push('desktop producer must upload the validated complete desktop set');
  }

  const compatibility = structuredClone(workflow);
  delete compatibility.on.workflow_call;
  compatibility.on.push.tags = ['v*'];
  compatibility.permissions.contents = 'write';
  compatibility.jobs.package.if = tagPushCondition;
  compatibility.jobs.release.if = tagPushCondition;
  const actionVersions = new Map([
    ['actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4'],
    ['actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 'actions/setup-node@v4'],
    ['actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', 'actions/upload-artifact@v4'],
    ['actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093', 'actions/download-artifact@v4'],
  ]);
  for (const job of Object.values(compatibility.jobs)) {
    for (const step of job?.steps ?? []) {
      if (actionVersions.has(step.uses)) step.uses = actionVersions.get(step.uses);
      if (step.run === coordinatedTagVersionRun) {
        step.run = tagVersionRun;
      }
    }
  }
  compatibility.jobs.release.steps.push({
    name: 'Publish release assets',
    run: publishRun,
  });
  failures.push(...verifyDesktopWorkflow(compatibility));
  return failures;
}

export function verifyDesktopWorkflow(workflow) {
  if (workflow?.on?.workflow_call !== undefined) {
    return verifyDesktopProducerWorkflow(workflow);
  }
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
  const validateSteps = jobs.validate?.steps ?? [];
  const validateNpmCiIndex = validateSteps.findIndex((step) => step.run === 'npm ci');
  const validateE2eIndex = validateSteps.findIndex((step) => step.run === 'npm run test:e2e');
  const playwrightInstallIndexes = validateSteps
    .map((step, index) => step.run === playwrightInstallRun ? index : -1)
    .filter((index) => index >= 0);
  if (playwrightInstallIndexes.length !== 1) {
    failures.push('validate job must install Playwright Chromium with Linux dependencies exactly once');
  } else if (
    playwrightInstallIndexes[0] <= validateNpmCiIndex
    || validateE2eIndex < 0
    || playwrightInstallIndexes[0] >= validateE2eIndex
  ) {
    failures.push(
      'validate job must install Playwright Chromium after npm ci and before existing E2E tests',
    );
  }
  if (!hasRun(jobs.validate, 'npm run test:desktop-workflow')) {
    failures.push('validate job must run desktop workflow tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:electron')) {
    failures.push('validate job must run Electron regression tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:release-artifacts')) {
    failures.push('validate job must run release artifact tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:release-tag')) {
    failures.push('validate job must run release tag tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:packaged-resources')) {
    failures.push('validate job must run packaged resource tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:packaged-app')) {
    failures.push('validate job must run packaged app tests');
  }
  if (!hasRun(jobs.validate, 'npm run test:e2e')) {
    failures.push('validate job must run existing E2E tests');
  }
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
  for (const [id, target, os, command, artifact] of expectedPackages) {
    const entry = packages?.find((candidate) => candidate.id === id);
    if (!entry) {
      failures.push(`package matrix is missing ${id}`);
      continue;
    }
    if (entry.target !== target) {
      failures.push(`${id} validator target must be ${target}`);
    }
    if (entry.os !== os) failures.push(`${id} must run on ${os}`);
    if (entry.command !== command) failures.push(`${id} command must be ${command}`);
    if (entry.artifact !== artifact) failures.push(`${id} must publish ${artifact.trim()}`);
  }
  const packageSteps = jobs.package?.steps ?? [];
  const matrixCommandIndex = packageSteps.findIndex((step) => step.run === '${{ matrix.command }}');
  const packageTagVersionIndexes = packageSteps
    .map((step, index) => step.run === tagVersionRun ? index : -1)
    .filter((index) => index >= 0);
  if (
    packageTagVersionIndexes.length !== 1
    || packageTagVersionIndexes[0] >= matrixCommandIndex
  ) {
    failures.push(
      'package job must use a portable tag expression before packaging; exact tag version before packaging is required',
    );
  }
  const packagedAppSmokeIndexes = packageSteps
    .map((step, index) => step.run === packagedAppSmokeRun ? index : -1)
    .filter((index) => index >= 0);
  const packageValidationIndexes = packageSteps
    .map((step, index) => step.run === packageArtifactValidationRun ? index : -1)
    .filter((index) => index >= 0);
  const artifactUpload = jobs.package?.steps?.find(
    (step) => step.uses === 'actions/upload-artifact@v4',
  );
  const artifactUploadIndex = packageSteps.indexOf(artifactUpload);
  if (packageValidationIndexes.length !== 1) {
    failures.push('package job must validate the exact matrix target exactly once');
  } else if (
    packageValidationIndexes[0] <= matrixCommandIndex
    || packageValidationIndexes[0] >= artifactUploadIndex
  ) {
    failures.push('package artifact validation must run after the matrix command and before upload');
  }
  if (
    packagedAppSmokeIndexes.length !== 1
    || packagedAppSmokeIndexes[0] <= matrixCommandIndex
    || packagedAppSmokeIndexes[0] >= packageValidationIndexes[0]
  ) {
    failures.push('package job must run packaged app smoke after packaging and before artifact validation');
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
  const releaseTagVersionIndexes = releaseSteps
    .map((step, index) => step.run === tagVersionRun ? index : -1)
    .filter((index) => index >= 0);
  if (checkoutIndex < 0) failures.push('release job must check out the validator source');
  if (
    releaseTagVersionIndexes.length !== 1
    || releaseTagVersionIndexes[0] <= checkoutIndex
    || releaseTagVersionIndexes[0] >= publishIndex
  ) {
    failures.push(
      'release job must use a portable tag expression before publishing; exact tag version before publishing is required',
    );
  }
  if (download?.with?.path !== 'release-assets') {
    failures.push('release download must use release-assets');
  }
  if (download?.with?.['merge-multiple'] !== true) {
    failures.push('release download must merge artifacts into one directory');
  }
  if (releaseValidationIndexes.length !== 1) {
    failures.push('release job must validate the complete artifact set exactly once');
  } else {
    if (checkoutIndex < 0 || checkoutIndex >= releaseValidationIndexes[0]) {
      failures.push('release job must check out before artifact validation');
    }
    if (
      releaseValidationIndexes[0] <= downloadIndex
      || releaseValidationIndexes[0] >= publishIndex
    ) {
      failures.push('release artifact validation must run after download and before publishing');
    }
  }
  const publish = releaseSteps[publishIndex];
  if (publish?.run !== publishRun) {
    failures.push('release reruns must delete existing release assets before publishing');
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
