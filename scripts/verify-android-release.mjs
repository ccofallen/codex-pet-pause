import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const applicationId = 'io.elevenlabs.codexpetpause';
const minimumVersionCode = 30000;
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
const tagPushCondition = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";
const androidTestRun = 'npm run test:run -- src/android src/i18n src/features/pets';
const releaseBuildRun = 'cd android && ./gradlew --no-daemon clean :app:assembleRelease';
const releaseUploadRun =
  'if ! gh release view "$GITHUB_REF_NAME"; then\n'
  + '  gh release create "$GITHUB_REF_NAME" --generate-notes --title "Codex Pet Pause $GITHUB_REF_NAME" '
  + '|| gh release view "$GITHUB_REF_NAME"\n'
  + 'fi\n'
  + 'gh release upload "$GITHUB_REF_NAME" "$ANDROID_APK" "$ANDROID_CHECKSUM" --clobber\n';

function failure(message) {
  throw new Error(message);
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
  const apksigner = await findBuildTool('apksigner');
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
  if (inspection.packageName !== applicationId) {
    failure(`Android package must be ${applicationId}; found ${inspection.packageName ?? 'none'}.`);
  }
  if (inspection.versionName !== expectedVersion) {
    failure(`Android versionName must be ${expectedVersion}; found ${inspection.versionName ?? 'none'}.`);
  }
  if (!Number.isInteger(inspection.versionCode) || inspection.versionCode < minimumVersionCode) {
    failure(
      `Android versionCode must be at least ${minimumVersionCode}; found ${inspection.versionCode}.`,
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
  const push = workflow?.on?.push;
  if (!push?.branches?.includes('main')) failures.push('Android workflow pushes must include main');
  if (!push?.tags?.includes('v*')) failures.push('Android workflow pushes must include v* tags');
  if (workflow?.on?.pull_request === undefined) failures.push('Android workflow must run for pull requests');
  if (workflow?.on?.workflow_dispatch === undefined) {
    failures.push('Android workflow must support manual dispatch');
  }
  if (workflow?.permissions?.contents !== 'write') {
    failures.push('Android workflow must allow writing release contents');
  }

  const job = workflow?.jobs?.build;
  const steps = job?.steps ?? [];
  if (job?.['runs-on'] !== 'ubuntu-latest') failures.push('Android build must run on ubuntu-latest');
  if (!steps.some((step) => step.uses === 'actions/setup-node@v4' && step.with?.['node-version'] === 22)) {
    failures.push('Android workflow must install Node 22');
  }
  if (!steps.some((step) => (
    step.uses === 'actions/setup-java@v4'
    && step.with?.['java-version'] === 21
    && step.with?.distribution === 'temurin'
  ))) {
    failures.push('Android workflow must install Java 21');
  }
  if (!steps.some((step) => step.uses === 'android-actions/setup-android@v3')) {
    failures.push('Android workflow must install the Android SDK');
  }
  for (const command of [
    'npm ci',
    'npm run typecheck',
    androidTestRun,
    'npm run android:sync',
    'npm run android:test:native',
    'cd android && ./gradlew lintDebug',
    'cd android && ./gradlew assembleDebug',
    releaseBuildRun,
  ]) {
    if (!hasRun(job, command)) failures.push(`Android workflow is missing: ${command}`);
  }

  const secretGuard = steps.find((step) => step.name === 'Require Android release signing secrets');
  const secretNames = [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_STORE_PASSWORD',
  ];
  if (
    secretGuard?.if !== tagPushCondition
    || !secretNames.every((name) => (
      secretGuard.env?.[name] === '${{ secrets.' + name + ' }}'
      && secretGuard.run?.includes(name)
    ))
  ) {
    failures.push('Android tag builds must fail closed when signing secrets are missing');
  }
  const decode = steps.find((step) => step.name === 'Decode Android release keystore');
  if (
    decode?.if !== tagPushCondition
    || !decode.run?.includes('base64 --decode')
    || !decode.run?.includes('chmod 600')
    || decode.env?.ANDROID_KEYSTORE_BASE64 !== '${{ secrets.ANDROID_KEYSTORE_BASE64 }}'
  ) {
    failures.push('Android tag builds must decode the secret keystore securely');
  }
  const releaseBuild = steps.find((step) => step.run === releaseBuildRun);
  if (
    releaseBuild?.if !== tagPushCondition
    || !secretNames.slice(1).every((name) => (
      releaseBuild.env?.[name] === '${{ secrets.' + name + ' }}'
    ))
  ) {
    failures.push('Android release build must receive signing values only from GitHub secrets');
  }
  const signingVerification = steps.find((step) => step.name === 'Verify signed Android release');
  if (
    signingVerification?.if !== tagPushCondition
    || !signingVerification.run?.includes('apksigner')
    || !signingVerification.run?.includes('verify --verbose --print-certs')
    || !signingVerification.run?.includes('node scripts/verify-android-release.mjs')
  ) {
    failures.push('Android release must verify signing and artifact contents before upload');
  }
  const staging = steps.find((step) => step.name === 'Stage deterministic Android release assets');
  if (
    staging?.if !== tagPushCondition
    || !staging.run?.includes('APK_NAME="Codex-Pet-Pause-$VERSION-android-universal.apk"')
    || !staging.run?.includes(
      'cp android/app/build/outputs/apk/release/app-release.apk "$ARTIFACT_DIR/$APK_NAME"',
    )
    || /(?:android-arm64|app-arm64-v8a)/u.test(staging.run)
  ) {
    failures.push('Android release staging must use the universal filename and unsplit APK');
  }
  const debugUpload = steps.find((step) => (
    step.uses === 'actions/upload-artifact@v4' && step.name === 'Upload debug APK'
  ));
  const releaseUpload = steps.find((step) => (
    step.uses === 'actions/upload-artifact@v4' && step.name === 'Upload signed Android artifact'
  ));
  if (!debugUpload || !releaseUpload) {
    failures.push('Android workflow must upload an Actions artifact on every successful build');
  }
  const publish = steps.find((step) => step.name === 'Publish Android release assets');
  if (publish?.if !== tagPushCondition || publish?.run !== releaseUploadRun) {
    failures.push('Android release publishing must upload only the two exact Android paths');
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
