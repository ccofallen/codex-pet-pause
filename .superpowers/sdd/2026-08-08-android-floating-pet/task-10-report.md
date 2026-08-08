# Task 10 Packaging and Release Preparation Report

Date: 2026-08-08
Base SHA: `12f0c92459b807156bebcd71b98b60903a9050f6`
Status: release preparation complete; no tag, GitHub Release, secret update, or publication performed

## Release contract

- Package/application version: `0.3.0`
- Android package: `io.elevenlabs.codexpetpause`
- Android `versionName`: `0.3.0`
- Android `versionCode`: `30000`
- Android output: one universal pure-JVM/WebView APK with no native `.so` libraries
- Compatibility: Android 9 and newer, including arm64 devices and other CPU architectures supported by the Android runtime and system WebView
- Desktop outputs preserved: macOS arm64 and x64, Windows x64, and Linux x64 AppImage/deb packages

## Exact local artifact evidence

Artifact path:

`/Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/.artifacts/android/Codex-Pet-Pause-0.3.0-android-universal.apk`

Checksum path:

`/Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/.artifacts/android/Codex-Pet-Pause-0.3.0-android-universal.apk.sha256`

SHA-256:

`62a888e34f8a411ebaa077e59e0993fff99aa3eda9b97dd26d49185f0b61b00c`

Artifact size: `10550932` bytes

The checksum file contains exactly:

```text
62a888e34f8a411ebaa077e59e0993fff99aa3eda9b97dd26d49185f0b61b00c  Codex-Pet-Pause-0.3.0-android-universal.apk
```

The artifact and checksum are ignored local outputs. They are not included in the source commit. Existing untracked `release/` assets were not modified or deleted. The regenerated untracked `dist-android/` output was accepted by the user and is not included in the source commit.

## APK signing and content verification

`apksigner verify --verbose --print-certs` passed with APK Signature Scheme v2, one signer, and an RSA 4096-bit key.

- Signer DN: `CN=Codex Pet Pause, OU=Release, O=Codex Pet Pause, L=London, ST=England, C=GB`
- Signer certificate SHA-256: `c59972e77d310df610465cabe668f3569de9630bb64c687cc7677f433f129e56`
- Debug signing certificate: not present
- Native `.so` entries: `0`
- Compatibility result: `universal-pure-jvm-webview`
- arm64 compatibility result: `true`
- Development server URLs: none detected in Capacitor configuration or packaged web content

The final verifier accepted only these permissions:

- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`
- `android.permission.INTERNET`
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.RECEIVE_BOOT_COMPLETED`
- `android.permission.SYSTEM_ALERT_WINDOW`
- `io.elevenlabs.codexpetpause.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

No unexpected permission was present. The final verifier also proved the production web entry point and JavaScript bundle are packaged.

## TDD and bounded verification evidence

The universal-release tests were written first. Before implementation they failed against the arm64 filename/ABI-only contract. After implementation, the focused release-contract suite passed all `45` tests.

| Gate | Bounded command | Result |
| --- | --- | --- |
| Release contracts | `node --test scripts/verify-android-release.test.mjs scripts/verify-desktop-workflow.test.mjs` | PASS, 45/45 |
| TypeScript | `npm run typecheck` | PASS |
| Web tests | `npm run test:run` | PASS, 68 files and 794 tests |
| Android JVM tests | `npm run android:test:native` | PASS, Gradle build successful in 28s |
| Android web sync | `npm run android:sync` | PASS |
| Android lint and debug | `cd android && ./gradlew --no-daemon lintDebug assembleDebug` | PASS, 134 tasks in 22s; only existing Capacitor baseline hints/deprecations |
| Resumed desktop E2E | `npx playwright test e2e/reminders.spec.ts` | PASS, 8/8 in 8.1s |
| Desktop build | `npm run desktop:build` | PASS |
| Desktop packaged resources | `npm run desktop:smoke:packaged-resources` | PASS |
| Clean signed release | `npm run android:apk:release` | PASS, 123 tasks in 19s |
| Signature | `apksigner verify --verbose --print-certs <universal-apk>` | PASS |
| Final artifact contract | `node scripts/verify-android-release.mjs .artifacts/android` | PASS |
| Source whitespace | `git diff --check` | PASS |
| Stale arm64-only claim scan | focused `rg` over workflow, Gradle, README, install docs, and release notes | PASS, no matches |

Every long-running process used a 30-second alarm. An earlier full desktop release chain was intentionally stopped at the bound after `34` Playwright tests passed, `1` was interrupted, and `5` had not run; it had not yet reached desktop build or packaged-resource smoke. The interrupted reminders coverage was resumed as the focused reminders spec and passed `8/8`, then the two unreached desktop gates passed. No command is currently hanging.

The clean release build succeeded before a chained `apksigner` invocation reported that it could not locate Java because that post-build process did not inherit `JAVA_HOME`. The already-built artifact was not changed; signature and complete artifact verification were rerun with the requested JDK environment and passed.

## Signing key and GitHub secret status

A new long-lived local release keystore was generated because no release key existed.

- Keystore: `.signing/codex-pet-pause-release.jks`
- Properties: `.signing/signing.properties`
- Directory mode: `700`
- Keystore mode: `600`
- Properties mode: `600`
- Key algorithm/size: RSA 4096-bit
- Validity: 36500 days
- Credentials: independent cryptographically random values; never printed
- Git status: `.signing/` is ignored and no signing path is tracked

The following GitHub secrets have not been set:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`

After independent review, an authenticated and authorized maintainer can set them without displaying their values:

```bash
base64 < .signing/codex-pet-pause-release.jks | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
awk -F= '$1 == "keyAlias" { print substr($0, index($0, "=") + 1) }' .signing/signing.properties | gh secret set ANDROID_KEY_ALIAS
awk -F= '$1 == "keyPassword" { print substr($0, index($0, "=") + 1) }' .signing/signing.properties | gh secret set ANDROID_KEY_PASSWORD
awk -F= '$1 == "storePassword" { print substr($0, index($0, "=") + 1) }' .signing/signing.properties | gh secret set ANDROID_STORE_PASSWORD
```

The release workflow fails closed on tag builds if any signing secret is absent. Pull requests, main pushes, and local debug builds remain straightforward and do not require release credentials.

**Signing-key backup warning:** securely back up both `.signing/codex-pet-pause-release.jks` and `.signing/signing.properties` together in an encrypted, access-controlled location before publication. Loss of the keystore or either credential prevents signing in-place updates for the published Android application identity.

## Documentation and publication status

English and Chinese README, install, and `0.3.0` release-note documentation now covers:

- the universal APK and SHA-256 filename
- direct installation from GitHub Releases
- unknown-app installation approval
- overlay permission setup
- Android 13+ notification permission setup
- local release signing setup and fail-closed behavior
- exact GitHub secret preparation
- preserved desktop release assets

No GitHub secret was configured. No tag was created. No GitHub Release was created or updated. No asset was published. The parent process will independently review this commit before configuring secrets and publishing.

## Remaining device-only gap

Automated verification cannot prove OEM-specific behavior on physical hardware. The remaining release gate is a manual install on a real arm64 Android device followed by overlay approval, Android 13+ notification approval where applicable, floating-pet interaction, foreground-service persistence, reminder delivery, and reboot recovery checks.
