import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import {
  verifyAndroidRelease,
  verifyAndroidWorkflow,
} from './verify-android-release.mjs';

const version = '0.3.0';
const apkName = `Codex-Pet-Pause-${version}-android-universal.apk`;
const checksumName = `${apkName}.sha256`;
const expectedPermissions = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'io.elevenlabs.codexpetpause.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];

function validInspection(overrides = {}) {
  return {
    signatureVerified: true,
    signerDn: 'CN=Codex Pet Pause, O=Codex Pet Pause, C=GB',
    signerSha256: 'c59972e77d310df610465cabe668f3569de9630bb64c687cc7677f433f129e56',
    packageName: 'io.elevenlabs.codexpetpause',
    versionName: version,
    versionCode: 30000,
    permissions: expectedPermissions,
    entries: [
      'assets/public/index.html',
      'assets/public/assets/index-release.js',
    ],
    forbiddenDevelopmentUrls: [],
    capacitorServerUrlPresent: false,
    ...overrides,
  };
}

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-android-release-'));
  const apk = options.apkContents ?? Buffer.from('signed universal release apk');
  const digest = createHash('sha256').update(apk).digest('hex');
  await writeFile(join(directory, apkName), apk);
  await writeFile(
    join(directory, checksumName),
    `${options.digest ?? digest}  ${apkName}\n`,
  );
  for (const extra of options.extraAssets ?? []) {
    await writeFile(join(directory, extra), 'unexpected');
  }
  return {
    directory,
    inspectApk: async () => validInspection(options.inspection),
  };
}

async function withFixture(options, run) {
  const release = await fixture(options);
  try {
    return await run(release);
  } finally {
    await rm(release.directory, { recursive: true, force: true });
  }
}

test('accepts exactly one signed universal APK and matching digest', async () => {
  await withFixture({}, async ({ directory, inspectApk }) => {
    const result = await verifyAndroidRelease(directory, version, { inspectApk });
    assert.deepEqual(result.assets, [apkName, checksumName]);
    assert.equal(result.packageName, 'io.elevenlabs.codexpetpause');
    assert.equal(result.versionName, version);
    assert.equal(result.versionCode, 30000);
    assert.deepEqual(result.nativeLibraries, []);
    assert.equal(result.compatibility, 'universal-pure-jvm-webview');
    assert.equal(result.arm64Compatible, true);
  });
});

test('rejects a digest mismatch or any extra release asset', async (t) => {
  await t.test('digest mismatch', async () => {
    await withFixture({ digest: '0'.repeat(64) }, async ({ directory, inspectApk }) => {
      await assert.rejects(
        verifyAndroidRelease(directory, version, { inspectApk }),
        /SHA-256 checksum does not match/,
      );
    });
  });
  await t.test('extra asset', async () => {
    await withFixture(
      { extraAssets: ['Codex-Pet-Pause-0.3.0-android-arm64.apk'] },
      async ({ directory, inspectApk }) => {
        await assert.rejects(
          verifyAndroidRelease(directory, version, { inspectApk }),
          /Unexpected Android release asset/,
        );
      },
    );
  });
});

test('rejects unsigned, debug-signed, native-library, or development APKs', async (t) => {
  const cases = [
    ['unsigned', { signatureVerified: false }, /signature verification failed/],
    ['debug signing', { signerDn: 'CN=Android Debug, O=Android, C=US' }, /debug signing certificate/],
    [
      'native library',
      { entries: ['assets/public/index.html', 'lib/arm64-v8a/libapp.so'] },
      /must not contain native \.so libraries/,
    ],
    [
      'development URL',
      { forbiddenDevelopmentUrls: ['http://10.0.2.2:5173'] },
      /development server URL/,
    ],
  ];
  for (const [name, inspection, message] of cases) {
    await t.test(name, async () => {
      await withFixture({ inspection }, async ({ directory, inspectApk }) => {
        await assert.rejects(verifyAndroidRelease(directory, version, { inspectApk }), message);
      });
    });
  }
});

test('rejects wrong manifest identity, stale version codes, and permission creep', async (t) => {
  const cases = [
    ['package', { packageName: 'example.debug' }, /package must be io\.elevenlabs\.codexpetpause/],
    ['version name', { versionName: '0.2.6' }, /versionName must be 0\.3\.0/],
    ['version code', { versionCode: 30001 }, /versionCode must be exactly 30000/],
    [
      'permission',
      { permissions: [...expectedPermissions, 'android.permission.READ_CONTACTS'] },
      /Unexpected Android permission: android\.permission\.READ_CONTACTS/,
    ],
  ];
  for (const [name, inspection, message] of cases) {
    await t.test(name, async () => {
      await withFixture({ inspection }, async ({ directory, inspectApk }) => {
        await assert.rejects(verifyAndroidRelease(directory, version, { inspectApk }), message);
      });
    });
  }
});

test('Android workflow validates debug builds and uploads exact coordinated release assets', async () => {
  const workflow = parse(await readFile('.github/workflows/build-android.yml', 'utf8'));
  assert.deepEqual(verifyAndroidWorkflow(workflow), []);
});

test('Android workflow verifier rejects missing secret guards and keystore cleanup', async () => {
  const workflow = parse(await readFile('.github/workflows/build-android.yml', 'utf8'));
  const invalid = structuredClone(workflow);
  invalid.jobs.build.steps = invalid.jobs.build.steps.filter(
    (step) => ![
      'Require Android release signing secrets',
      'Clean up Android release keystore',
    ].includes(step.name),
  );
  const failures = verifyAndroidWorkflow(invalid);
  assert.ok(failures.some((failure) => failure.includes('fail closed')));
  assert.ok(failures.some((failure) => failure.includes('cleanup must always run')));
});

test('Android workflow verifier rejects an architecture-specific staged filename', async () => {
  const workflow = parse(await readFile('.github/workflows/build-android.yml', 'utf8'));
  const invalid = structuredClone(workflow);
  const stage = invalid.jobs.build.steps.find(
    (step) => step.name === 'Stage named Android release assets',
  );
  stage.run = stage.run.replace('android-universal.apk', 'android-arm64.apk');
  assert.ok(
    verifyAndroidWorkflow(invalid).some((failure) => failure.includes('universal filename')),
  );
});
