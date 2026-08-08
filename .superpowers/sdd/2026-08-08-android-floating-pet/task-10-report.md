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

`681e8241a17e942cb25a6aabf1d893c91bacebbfda27c9107dd0181c03efac1d`

Artifact size: `10552144` bytes

The checksum file contains exactly:

```text
681e8241a17e942cb25a6aabf1d893c91bacebbfda27c9107dd0181c03efac1d  Codex-Pet-Pause-0.3.0-android-universal.apk
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

## Post-review release-safety remediation

Review range: `12f0c92..d1d0868`

The review findings were addressed with a second RED/GREEN cycle. The initial focused
safety suite failed all `9/9` review contracts before implementation. An additional
draft-publication and explicit-backup-rules cycle then failed `2/10` contracts before
those protections were added. The final combined release contract run passed `75/75`.

- Android verifies `scripts/verify-release-tag.mjs` before any signing step.
- Android and desktop workflows are read-only reusable artifact producers and no longer
  publish GitHub Releases directly or trigger independently for tags.
- One tag-triggered publisher waits for both producers, revalidates the complete desktop
  and Android artifact directories, and is the only job granted `contents: write`.
- First publication is created as a draft only after validation, all seven validated
  assets are uploaded with `--clobber`, and the release is made public only after upload.
  Reruns preserve unrelated existing assets and update the same names idempotently.
- The intended Android signer certificate SHA-256 is pinned to
  `c59972e77d310df610465cabe668f3569de9630bb64c687cc7677f433f129e56`.
- Packaged `assets/capacitor.config.json` is parsed as JSON and `server.url` must be
  absent; local development and remote WebView endpoints are rejected.
- Android `versionCode` is derived from the exact semantic release version and must be
  exactly `30000` for `0.3.0`.
- `android:allowBackup="false"`, legacy full-backup exclusions, and Android 12+ cloud
  backup/device-transfer exclusions disable backup of app-private data. Same-key in-place
  APK upgrades still preserve local data; uninstalling removes it.
- Temporary CI signing uses `umask 077`, a mode-`700` directory, a mode-`600`
  keystore, and an unconditional cleanup step.
- External Actions are pinned to immutable commit SHAs. Gradle `8.14.3-all` is pinned
  with distribution SHA-256
  `ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c`.
- These controls improve dependency and workflow reproducibility; they do not claim that
  independently produced APK bytes are bit-for-bit reproducible.

### Post-review bounded verification

| Gate | Result |
| --- | --- |
| Combined release contracts | PASS, 75/75 |
| Pinned actionlint 1.7.12 on all three workflows | PASS |
| TypeScript | PASS |
| Full Vitest | PASS, 68 files and 794 tests |
| Android JVM | PASS in 19s |
| Android sync, lint, and debug APK | PASS in 24s |
| Desktop release config | PASS, 11/11 |
| Electron regressions | PASS, 3 files and 10 tests |
| macOS signing hooks | PASS, 2/2 |
| Packaged resource tests | PASS, 7/7 |
| Packaged app tests | PASS, 4/4 |
| Web and desktop builds plus packaged-resource smoke | PASS |
| Full Playwright | PASS, 40/40 in 23.5s |
| Clean signed universal release | PASS in 19s |
| `apksigner` plus hardened artifact verifier | PASS |

The regenerated artifact is `10552144` bytes with SHA-256
`681e8241a17e942cb25a6aabf1d893c91bacebbfda27c9107dd0181c03efac1d`.
No command timed out or remains running during this remediation.

### Residual limitation

Automated tests validate the manifest backup declarations and exclusion resources but
cannot prove every OEM's device-transfer implementation. Physical arm64-device acceptance
remains required for installation, overlay/notification permission flow, foreground
service persistence, reminders, reboot recovery, and OEM backup/device-transfer behavior.

## Second review release-coordination remediation

Review starting commit: `915d0bd41af9da2299b4a4cbb96022df25edd7ff`

The four new coordination contracts were written before the workflow fixes and failed
`0/4` against the reviewed implementation for the expected reasons: unprefixed desktop
matrix artifacts, inherited Android secrets, dependency installation in the write-capable
publisher, and publication logic that could clobber an already-public release.

- Desktop matrix artifacts now use the `desktop-*` namespace, and the reusable aggregate
  job downloads only the explicit `desktop-*` pattern before validating the complete
  desktop set. This prevents Android artifacts from entering desktop validation.
- The coordinator maps only `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD` to the Android producer; it does
  not inherit unrelated secrets.
- A read-only `validate` job performs checkout, `npm ci`, exact tag verification, download,
  Android/desktop validation, and complete-set staging. Checkout credential persistence is
  disabled in all three release workflows.
- The sole `contents: write` publisher downloads the already-validated set and performs no
  checkout, Node setup, package installation, or dependency lifecycle.
- Publication fails closed when the tagged release already exists publicly. A missing
  release is created as a draft, and only an existing draft can be retried with `--clobber`.
  After upload, the publisher requires the release to remain a draft and compares the exact
  sorted remote asset-name set with the validated local set before making the draft public.
- The active plan and Task 10 brief now consistently require one universal pure-JVM/WebView
  APK with no ABI splits or `abiFilters`; arm64 is a compatible device architecture, not an
  APK restriction.
- `test:android-release` now invokes `verify-release-coordination.test.mjs` explicitly, and
  the safety suite asserts that this wiring remains present so CI cannot silently omit the
  four coordinated-publication contracts.

### Second-review bounded verification

| Gate | Result |
| --- | --- |
| Initial focused coordination contracts | RED, 0/4 for the expected missing protections |
| Follow-up npm gate-wiring contract | RED, 27 passed and 1 failed for the expected omitted suite |
| Focused coordination plus release safety | PASS, 14/14 |
| Desktop workflow contracts | PASS, 28/28 |
| Combined Android, desktop, safety, and coordination contracts | PASS, 59/59 |
| Wired Android release gate | PASS, 32/32 |
| Release tag contracts | PASS, 3/3 |
| Desktop release artifact contracts | PASS, 17/17 |
| Pinned actionlint 1.7.12 on all three workflows | PASS |
| Active plan/brief contradictory ABI claim scan | PASS, no matches |
| Source whitespace | PASS |

No Android source, resource, generated asset, or packaged payload changed in this review.
The APK was not rebuilt. Its size remains `10552144` bytes and its SHA-256 remains
`681e8241a17e942cb25a6aabf1d893c91bacebbfda27c9107dd0181c03efac1d`, matching the
existing checksum file. No tag, release, asset publication, or GitHub secret update was
performed, and existing untracked `release/` and `dist-android/` outputs were untouched.
