import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const applicationId = 'io.elevenlabs.codexpetpause';
const expectedSignerSha256 = 'c59972e77d310df610465cabe668f3569de9630bb64c687cc7677f433f129e56';
const allowedPermissions = new Set([
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.INTERNET',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'io.elevenlabs.codexpetpause.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);
const developmentUrlPattern =
  /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(?::\d+)?/giu;
const androidTestRun = 'npm run test:run -- src/android src/i18n src/features/pets';
const releaseBuildRun = 'cd android && ./gradlew --no-daemon clean :app:assembleRelease';

function failure(message) {
  throw new Error(message);
}

export function androidVersionCodeFor(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (match === null) failure(`Android release version must be major.minor.patch; found ${version}.`);
  const [, majorText, minorText, patchText] = match;
  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt(minorText, 10);
  const patch = Number.parseInt(patchText, 10);
  if (minor > 99 || patch > 99) {
    failure(`Android release minor and patch versions must be at most 99; found ${version}.`);
  }
  return (major * 1_000_000) + (minor * 10_000) + (patch * 100);
}

async function findBuildTool(name) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (sdkRoot !== undefined) {
    const buildToolsDirectory = join(sdkRoot, 'build-tools');
    try {
      const versions = await readdir(buildToolsDirectory);
      versions.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      for (const version of versions) {
        const candidate = join(buildToolsDirectory, version, name);
        try {
          await access(candidate, constants.X_OK);
          return candidate;
        } catch {
          // Continue to the next installed Build Tools version.
        }
      }
    } catch {
      // Fall back to PATH and let execFile report a focused error.
    }
  }
  return name;
}

async function run(tool, args, options = {}) {
  try {
    return await execFileAsync(tool, args, {
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const details = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`${basename(tool)} failed: ${details}`);
  }
}

function extractQuotedValue(text, name) {
  return text.match(new RegExp(`${name}='([^']+)'`))?.[1];
}

async function inspectApkWithAndroidSdk(apkPath) {
  const apksigner =
    process.env.ANDROID_APKSIGNER?.trim() ||
    (await findBuildTool('apksigner'));
  const aapt2 = await findBuildTool('aapt2');
  const unzip = process.platform === 'win32' ? 'unzip' : '/usr/bin/unzip';

  let signatureOutput;
  try {
    signatureOutput = (
      await run(apksigner, ['verify', '--verbose', '--print-certs', apkPath])
    ).stdout;
  } catch (error) {
    throw new Error(`Android APK signature verification failed: ${error.message}`);
  }
  const signerDn = signatureOutput.match(/Signer #\d+ certificate DN: (.+)/u)?.[1]?.trim();
  const signerSha256 = signatureOutput
    .match(/Signer #\d+ certificate SHA-256 digest: (.+)/u)?.[1]?.trim();

  const badging = (await run(aapt2, ['dump', 'badging', apkPath])).stdout;
  const packageLine = badging.split(/\r?\n/u).find((line) => line.startsWith('package:')) ?? '';
  const permissions = [...badging.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/gu)]
    .map((match) => match[1]);
  const entries = (await run(unzip, ['-Z1', apkPath])).stdout
    .split(/\r?\n/u)
    .filter(Boolean);
  const capacitorConfigEntry = 'assets/capacitor.config.json';
  if (!entries.includes(capacitorConfigEntry)) {
    failure('Android APK is missing assets/capacitor.config.json.');
  }
  const capacitorConfigOutput = (
    await run(unzip, ['-p', apkPath, capacitorConfigEntry], { encoding: 'buffer' })
  ).stdout;
  const capacitorConfigContents = Buffer.isBuffer(capacitorConfigOutput)
    ? capacitorConfigOutput.toString('utf8')
    : String(capacitorConfigOutput);
  let capacitorConfig;
  try {
    capacitorConfig = JSON.parse(capacitorConfigContents);
  } catch (error) {
    throw new Error(`Packaged assets/capacitor.config.json is invalid JSON: ${error.message}`);
  }
  const capacitorServer = capacitorConfig?.server;
  const capacitorServerUrlPresent = (
    capacitorServer !== null
    && typeof capacitorServer === 'object'
    && Object.hasOwn(capacitorServer, 'url')
  );
  const capacitorServerUrl = capacitorServerUrlPresent ? capacitorServer.url : undefined;
  const forbiddenDevelopmentUrls = [];
  const scannableEntries = entries.filter((entry) => (
    entry === 'assets/capacitor.config.json'
    || (
      entry.startsWith('assets/public/')
      && !/\.(?:png|webp|jpe?g|gif|ico|wav|mp3|woff2?|ttf|otf)$/iu.test(entry)
    )
  ));
  for (const entry of scannableEntries) {
    const output = (await run(unzip, ['-p', apkPath, entry], { encoding: 'buffer' })).stdout;
    const contents = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
    forbiddenDevelopmentUrls.push(...(contents.match(developmentUrlPattern) ?? []));
  }

  return {
    signatureVerified: true,
    signerDn,
    signerSha256,
    packageName: extractQuotedValue(packageLine, 'name'),
    versionName: extractQuotedValue(packageLine, 'versionName'),
    versionCode: Number.parseInt(extractQuotedValue(packageLine, 'versionCode') ?? '', 10),
    permissions,
    entries,
    capacitorServerUrlPresent,
    capacitorServerUrl,
    forbiddenDevelopmentUrls: [...new Set(forbiddenDevelopmentUrls)],
  };
}

function validateInspection(inspection, expectedVersion) {
  if (inspection.signatureVerified !== true) {
    failure('Android APK signature verification failed.');
  }
  if (!inspection.signerDn || !inspection.signerSha256) {
    failure('Android APK signer certificate metadata is missing.');
  }
  if (/android debug/iu.test(inspection.signerDn)) {
    failure('Android APK uses the Android debug signing certificate.');
  }
  const signerSha256 = inspection.signerSha256.replaceAll(':', '').toLowerCase();
  if (signerSha256 !== expectedSignerSha256) {
    failure(
      `Android release signer certificate SHA-256 fingerprint must be ${expectedSignerSha256}; found ${signerSha256}.`,
    );
  }
  if (inspection.packageName !== applicationId) {
    failure(`Android package must be ${applicationId}; found ${inspection.packageName ?? 'none'}.`);
  }
  if (inspection.versionName !== expectedVersion) {
    failure(`Android versionName must be ${expectedVersion}; found ${inspection.versionName ?? 'none'}.`);
  }
  const expectedVersionCode = androidVersionCodeFor(expectedVersion);
  if (inspection.versionCode !== expectedVersionCode) {
    failure(
      `Android versionCode must be exactly ${expectedVersionCode}; found ${inspection.versionCode}.`,
    );
  }

  const entries = inspection.entries ?? [];
  const nativeLibraries = entries
    .filter((entry) => /^lib\/[^/]+\/[^/]+\.so$/u.test(entry))
    .sort();
  if (nativeLibraries.length > 0) {
    failure(
      `Universal Android APK must not contain native .so libraries; found ${nativeLibraries.join(', ')}.`,
    );
  }
  if (!entries.includes('assets/public/index.html')) {
    failure('Android APK is missing the production web entry point.');
  }
  if (!entries.some((entry) => /^assets\/public\/.+\.js$/u.test(entry))) {
    failure('Android APK is missing its production JavaScript bundle.');
  }
  if (inspection.capacitorServerUrlPresent === true) {
    failure(
      `Packaged assets/capacitor.config.json server.url must be absent; found ${String(inspection.capacitorServerUrl)}.`,
    );
  }
  if ((inspection.forbiddenDevelopmentUrls ?? []).length > 0) {
    failure(
      `Android APK contains a development server URL: ${inspection.forbiddenDevelopmentUrls[0]}`,
    );
  }

  const permissions = new Set(inspection.permissions ?? []);
  for (const permission of permissions) {
    if (!allowedPermissions.has(permission)) {
      failure(`Unexpected Android permission: ${permission}`);
    }
  }
  for (const permission of allowedPermissions) {
    if (!permissions.has(permission)) {
      failure(`Required Android permission is missing: ${permission}`);
    }
  }
  return {
    nativeLibraries,
    compatibility: 'universal-pure-jvm-webview',
    arm64Compatible: true,
  };
}

export async function verifyAndroidRelease(
  directory,
  version,
  { inspectApk = inspectApkWithAndroidSdk } = {},
) {
  const apkName = `Codex-Pet-Pause-${version}-android-universal.apk`;
  const checksumName = `${apkName}.sha256`;
  const expectedAssets = [apkName, checksumName];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !expectedAssets.includes(entry.name)) {
      failure(`Unexpected Android release asset: ${entry.name}`);
    }
  }
  for (const asset of expectedAssets) {
    const details = await stat(join(directory, asset)).catch(() => undefined);
    if (details === undefined || !details.isFile() || details.size === 0) {
      failure(`Missing Android release asset: ${asset}`);
    }
  }

  const apkPath = join(directory, apkName);
  const expectedDigest = createHash('sha256').update(await readFile(apkPath)).digest('hex');
  const checksum = await readFile(join(directory, checksumName), 'utf8');
  const checksumMatch = checksum.match(/^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/u);
  if (checksumMatch === null || checksumMatch[2] !== apkName) {
    failure('Android checksum file must contain exactly the APK SHA-256 and basename.');
  }
  if (checksumMatch[1] !== expectedDigest) {
    failure('Android SHA-256 checksum does not match the APK.');
  }

  const inspection = await inspectApk(apkPath);
  const { nativeLibraries, compatibility, arm64Compatible } = validateInspection(
    inspection,
    version,
  );
  return {
    assets: expectedAssets,
    sha256: expectedDigest,
    packageName: inspection.packageName,
    versionName: inspection.versionName,
    versionCode: inspection.versionCode,
    nativeLibraries,
    compatibility,
    arm64Compatible,
    capacitorServerUrlPresent: inspection.capacitorServerUrlPresent === true,
    signerDn: inspection.signerDn,
    signerSha256: inspection.signerSha256,
    permissions: [...inspection.permissions].sort(),
  };
}

function hasRun(job, command) {
  return job?.steps?.some((step) => step.run === command);
}

export function verifyAndroidWorkflow(workflow) {
  const failures = [];
  const releaseCondition = "inputs.release_tag != ''";
  const debugCondition = "inputs.release_tag == ''";
  const push = workflow?.on?.push;
  if (!push?.branches?.includes('main')) failures.push('Android workflow pushes must include main');
  if (push?.tags !== undefined) failures.push('Android producer must not run independently for tags');
  if (workflow?.on?.pull_request === undefined) failures.push('Android workflow must run for pull requests');
  if (workflow?.on?.workflow_dispatch === undefined) failures.push('Android workflow must support manual dispatch');
  if (workflow?.on?.workflow_call?.inputs?.release_tag === undefined) {
    failures.push('Android workflow must accept a coordinated release_tag input');
  }
  if (workflow?.permissions?.contents !== 'read') {
    failures.push('Android producer must use read-only repository permissions');
  }

  const job = workflow?.jobs?.build;
  const steps = job?.steps ?? [];
  if (job?.['runs-on'] !== 'ubuntu-latest') failures.push('Android build must run on ubuntu-latest');
  const expectedActions = [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3',
    'android-actions/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407',
  ];
  for (const action of expectedActions) {
    if (!steps.some((step) => step.uses === action)) failures.push(`Android workflow is missing pinned action: ${action}`);
  }
  const node = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  if (node?.with?.['node-version'] !== 22) failures.push('Android workflow must install Node 22');
  const java = steps.find((step) => step.uses?.startsWith('actions/setup-java@'));
  if (java?.with?.['java-version'] !== 21 || java?.with?.distribution !== 'temurin') {
    failures.push('Android workflow must install Temurin Java 21');
  }
  for (const command of [
    'npm ci',
    'npm run typecheck',
    'npm run test:android-release',
    androidTestRun,
    'npm run android:sync',
    'npm run android:test:native',
    'cd android && ./gradlew lintDebug',
    releaseBuildRun,
  ]) {
    if (!hasRun(job, command)) failures.push(`Android workflow is missing: ${command}`);
  }

  const tagVerification = steps.find((step) => step.name === 'Verify Android release tag');
  const secretGuard = steps.find((step) => step.name === 'Require Android release signing secrets');
  if (
    tagVerification?.if !== releaseCondition
    || tagVerification.env?.RELEASE_TAG !== '${{ inputs.release_tag }}'
    || tagVerification.run !== 'node scripts/verify-release-tag.mjs "$RELEASE_TAG"'
    || steps.indexOf(tagVerification) >= steps.indexOf(secretGuard)
  ) {
    failures.push('Android must verify the exact release tag before signing');
  }
  const secretNames = [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_STORE_PASSWORD',
  ];
  if (
    secretGuard?.if !== releaseCondition
    || !secretNames.every((name) => (
      secretGuard.env?.[name] === '${{ secrets.' + name + ' }}'
      && secretGuard.run?.includes(name)
    ))
  ) {
    failures.push('Android release builds must fail closed when signing secrets are missing');
  }
  const decode = steps.find((step) => step.name === 'Decode Android release keystore');
  if (
    decode?.if !== releaseCondition
    || !decode.run?.includes('umask 077')
    || !decode.run?.includes('chmod 700 "$RUNNER_TEMP/android-signing"')
    || !decode.run?.includes('chmod 600')
    || decode.env?.ANDROID_KEYSTORE_BASE64 !== '${{ secrets.ANDROID_KEYSTORE_BASE64 }}'
  ) {
    failures.push('Android release keystore must be decoded with private permissions');
  }
  const releaseBuild = steps.find((step) => step.run === releaseBuildRun);
  if (
    releaseBuild?.if !== releaseCondition
    || !secretNames.slice(1).every((name) => (
      releaseBuild.env?.[name] === '${{ secrets.' + name + ' }}'
    ))
  ) {
    failures.push('Android release build must receive signing values only from GitHub secrets');
  }
  const staging = steps.find((step) => step.name === 'Stage named Android release assets');
  if (
    staging?.if !== releaseCondition
    || !staging.run?.includes('APK_NAME="Codex-Pet-Pause-$VERSION-android-universal.apk"')
    || !staging.run?.includes('cp android/app/build/outputs/apk/release/app-release.apk "$ARTIFACT_DIR/$APK_NAME"')
    || /(?:android-arm64|app-arm64-v8a|bit-for-bit)/u.test(staging.run)
  ) {
    failures.push('Android release staging must use the universal filename and unsplit APK');
  }
  const signingVerification = steps.find((step) => step.name === 'Verify signed Android release');
  if (
    signingVerification?.if !== releaseCondition
    || !signingVerification.run?.includes('verify --verbose --print-certs')
    || !signingVerification.run?.includes('node scripts/verify-android-release.mjs')
  ) {
    failures.push('Android release must verify signing and artifact contents before upload');
  }
  const debugBuild = steps.find((step) => step.name === 'Build debug APK');
  const debugUpload = steps.find((step) => step.name === 'Upload debug APK');
  const releaseUpload = steps.find((step) => step.name === 'Upload signed Android artifact');
  if (debugBuild?.if !== debugCondition || debugUpload?.if !== debugCondition) {
    failures.push('Android debug builds must remain available outside coordinated releases');
  }
  if (
    releaseUpload?.if !== releaseCondition
    || releaseUpload.uses !== 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
  ) {
    failures.push('Android release must upload a pinned Actions artifact for the coordinator');
  }
  const cleanup = steps.find((step) => step.name === 'Clean up Android release keystore');
  if (cleanup?.if !== 'always()' || !cleanup.run?.includes('rm -rf "$RUNNER_TEMP/android-signing"')) {
    failures.push('Android release keystore cleanup must always run');
  }
  if (steps.some((step) => /gh release (?:create|upload|delete)/u.test(step.run ?? ''))) {
    failures.push('Android producer must never publish GitHub Release assets directly');
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, requestedVersion] = process.argv.slice(2);
  if (directory === undefined || process.argv.length > 4) {
    throw new Error(
      'Usage: node scripts/verify-android-release.mjs <directory> [version]',
    );
  }
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const version = requestedVersion ?? packageJson.version;
  const result = await verifyAndroidRelease(directory, version);
  console.log(
    `Android release is valid: ${result.assets.join(', ')}; ${result.sha256}`,
  );
}
