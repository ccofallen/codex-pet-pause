import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { verifyAndroidRelease } from './verify-android-release.mjs';

const version = '0.3.0';
const apkName = `Codex-Pet-Pause-${version}-android-universal.apk`;
const expectedSignerSha256 = 'c59972e77d310df610465cabe668f3569de9630bb64c687cc7677f433f129e56';
const permissions = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'io.elevenlabs.codexpetpause.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];
const validInspection = {
  signatureVerified: true,
  signerDn: 'CN=Codex Pet Pause, OU=Release, O=Codex Pet Pause, C=GB',
  signerSha256: expectedSignerSha256,
  packageName: 'io.elevenlabs.codexpetpause',
  versionName: version,
  versionCode: 30000,
  permissions,
  entries: ['assets/public/index.html', 'assets/public/app.js'],
  forbiddenDevelopmentUrls: [],
  capacitorServerUrlPresent: false,
};

async function withReleaseFixture(inspection, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'android-release-safety-'));
  try {
    const apk = Buffer.from('signed universal release fixture');
    const digest = createHash('sha256').update(apk).digest('hex');
    await writeFile(join(directory, apkName), apk);
    await writeFile(join(directory, `${apkName}.sha256`), `${digest}  ${apkName}\n`);
    await callback(directory, async () => inspection);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('pins and enforces the intended Android release signer certificate', async () => {
  await withReleaseFixture(
    { ...validInspection, signerSha256: '0'.repeat(64) },
    async (directory, inspectApk) => {
      await assert.rejects(
        verifyAndroidRelease(directory, version, { inspectApk }),
        /release signer certificate SHA-256 fingerprint/u,
      );
    },
  );
});

test('requires packaged capacitor server.url to be absent', async () => {
  await withReleaseFixture(
    {
      ...validInspection,
      capacitorServerUrlPresent: true,
      capacitorServerUrl: 'https://remote.example.invalid/app',
    },
    async (directory, inspectApk) => {
      await assert.rejects(
        verifyAndroidRelease(directory, version, { inspectApk }),
        /server\.url must be absent/u,
      );
    },
  );
});

test('requires the exact versionCode derived from the release version', async () => {
  await withReleaseFixture(
    { ...validInspection, versionCode: 30001 },
    async (directory, inspectApk) => {
      await assert.rejects(
        verifyAndroidRelease(directory, version, { inspectApk }),
        /versionCode must be exactly 30000/u,
      );
    },
  );
});

test('Gradle and APK inspection derive version metadata and parse Capacitor configuration', async () => {
  const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(gradle, /JsonSlurper/u);
  assert.match(gradle, /versionCode androidVersionCode/u);
  assert.match(gradle, /versionName releaseVersion/u);

  const verifier = await readFile(new URL('./verify-android-release.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /JSON\.parse\(capacitorConfigContents\)/u);
  assert.match(verifier, /capacitorServerUrlPresent/u);
});

async function workflow(name) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  return { source, parsed: parse(source) };
}

test('Android verifies the exact release tag before signing and never publishes directly', async () => {
  const { source, parsed } = await workflow('build-android.yml');
  const steps = parsed.jobs.build.steps;
  const tagIndex = steps.findIndex((step) => step.run?.includes('scripts/verify-release-tag.mjs'));
  const signingIndex = steps.findIndex((step) => step.name === 'Require Android release signing secrets');
  assert.ok(tagIndex >= 0, 'Android workflow must verify the release tag');
  assert.ok(tagIndex < signingIndex, 'release tag verification must precede signing');
  assert.equal(parsed.permissions.contents, 'read');
  assert.ok(parsed.on.workflow_call, 'Android workflow must support coordinated workflow_call');
  assert.equal(parsed.on.push.tags, undefined, 'Android producer must not race on tag pushes');
  assert.doesNotMatch(source, /gh release (?:create|upload|delete)/u);
});

test('one least-privilege publisher waits for and validates Android plus desktop artifacts', async () => {
  const releaseSource = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  ).catch(() => '');
  assert.notEqual(releaseSource, '', 'coordinated release workflow must exist');
  const release = parse(releaseSource);
  assert.equal(release.permissions.contents, 'read');
  assert.deepEqual(new Set(release.jobs.validate.needs), new Set(['android', 'desktop']));
  assert.equal(release.jobs.validate.permissions.contents, 'read');
  assert.equal(release.jobs.publish.needs, 'validate');
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  assert.match(releaseSource, /node scripts\/verify-release-tag\.mjs/u);
  assert.match(releaseSource, /node scripts\/verify-release-artifacts\.mjs/u);
  assert.match(releaseSource, /node scripts\/verify-android-release\.mjs/u);
  assert.match(releaseSource, /gh release upload[\s\S]*--clobber/u);
  assert.match(releaseSource, /gh release create[^\n]*--draft/u);
  assert.match(releaseSource, /gh release edit[^\n]*--draft=false/u);
  assert.doesNotMatch(releaseSource, /gh release delete-asset/u);
  assert.match(releaseSource, /concurrency:/u);

  const desktop = await workflow('build-desktop.yml');
  assert.equal(desktop.parsed.permissions.contents, 'read');
  assert.ok(desktop.parsed.on.workflow_call, 'Desktop workflow must support workflow_call');
  assert.equal(desktop.parsed.on.push.tags, undefined, 'Desktop producer must not race on tag pushes');
  assert.doesNotMatch(desktop.source, /gh release (?:create|upload|delete)/u);
  const combined = `${releaseSource}\n${desktop.source}\n${(await workflow('build-android.yml')).source}`;
  assert.equal((combined.match(/contents: write/gu) ?? []).length, 1);
});

test('release keystore creation is private and cleanup runs unconditionally', async () => {
  const { source } = await workflow('build-android.yml');
  assert.match(source, /umask 077/u);
  assert.match(source, /chmod 700 "\$RUNNER_TEMP\/android-signing"/u);
  assert.match(source, /name: Clean up Android release keystore[\s\S]*if: always\(\)/u);
});

test('external Actions and the Gradle distribution are pinned immutably', async () => {
  const expectedActions = new Map([
    ['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
    ['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
    ['actions/setup-java', 'cf277c60eb25467037889841efdb72551f06f6c3'],
    ['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
    ['actions/download-artifact', 'd3f86a106a0bac45b974a628896c90dbdf5c8093'],
    ['android-actions/setup-android', '9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407'],
  ]);
  const sources = await Promise.all([
    workflow('build-android.yml'),
    workflow('build-desktop.yml'),
    readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
      .then((source) => ({ source }))
      .catch(() => ({ source: '' })),
  ]);
  const combined = sources.map(({ source }) => source).join('\n');
  for (const [action, sha] of expectedActions) {
    if (combined.includes(`${action}@`)) assert.match(combined, new RegExp(`${action}@${sha}`));
  }
  assert.doesNotMatch(combined, /uses: [\w-]+\/[\w-]+@v\d+/u);

  const wrapper = await readFile(
    new URL('../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url),
    'utf8',
  );
  assert.match(
    wrapper,
    /^distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c$/mu,
  );
});

test('Android app data backup is disabled in the packaged manifest contract', async () => {
  const manifest = await readFile(
    new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
    'utf8',
  );
  assert.match(manifest, /android:allowBackup="false"/u);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/u);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/u);
  const legacyRules = await readFile(
    new URL('../android/app/src/main/res/xml/backup_rules.xml', import.meta.url),
    'utf8',
  ).catch(() => '');
  const modernRules = await readFile(
    new URL('../android/app/src/main/res/xml/data_extraction_rules.xml', import.meta.url),
    'utf8',
  ).catch(() => '');
  assert.match(legacyRules, /<exclude domain="root" path="\."\s*\/>/u);
  assert.match(modernRules, /<cloud-backup>[\s\S]*<exclude domain="root" path="\."\s*\/>/u);
  assert.match(modernRules, /<device-transfer>[\s\S]*<exclude domain="root" path="\."\s*\/>/u);
});

test('active plan, spec, brief, and install notes contain no arm64-only release claim', async () => {
  const files = [
    '../docs/superpowers/plans/2026-08-08-android-floating-pet.md',
    '../docs/superpowers/specs/2026-08-08-android-floating-pet-design.md',
    '../.superpowers/sdd/2026-08-08-android-floating-pet/task-10-brief.md',
    '../docs/ANDROID-INSTALL.md',
    '../docs/ANDROID-INSTALL.zh-CN.md',
    '../docs/RELEASE-NOTES-0.3.0.md',
    '../docs/RELEASE-NOTES-0.3.0.zh-CN.md',
  ];
  const combined = (await Promise.all(
    files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')),
  )).join('\n');
  assert.doesNotMatch(
    combined,
    /android-arm64|app-arm64-v8a|arm64-v8a|arm64[- ]only|builds only[^\n]*arm64|仅构建[^\n]*arm64|仅支持[^\n]*arm64/iu,
  );
});

test('npm Android release gate includes the coordinated publication contracts', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.match(
    packageJson.scripts['test:android-release'],
    /scripts\/verify-release-coordination\.test\.mjs/u,
  );
});
