### Task 10: Package, Document, and Release the APK Without Desktop Regressions

**Files:**
- Create: `.github/workflows/build-android.yml`
- Modify: `.github/workflows/build-desktop.yml`
- Create: `scripts/verify-android-release.mjs`
- Create: `scripts/verify-android-release.test.mjs`
- Modify: `scripts/verify-desktop-workflow.test.mjs`
- Create: `docs/ANDROID-INSTALL.md`
- Create: `docs/ANDROID-INSTALL.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Gradle `assembleRelease`, encrypted `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD` secrets.
- Produces: `Codex-Pet-Pause-<version>-android-universal.apk` plus `.sha256` in the same coordinated tagged GitHub Release as the complete desktop asset set.

- [ ] **Step 1: Write failing artifact and workflow tests**

```js
test('accepts exactly one signed universal APK and matching digest', async () => {
  const result = await verifyAndroidRelease(fixtureDir, '0.3.0');
  assert.deepEqual(result.assets, [
    'Codex-Pet-Pause-0.3.0-android-universal.apk',
    'Codex-Pet-Pause-0.3.0-android-universal.apk.sha256',
  ]);
});

test('rejects an unsigned APK or one containing native libraries', async () => {
  await assert.rejects(() => verifyAndroidRelease(unsignedFixture, '0.3.0'));
});
```

- [ ] **Step 2: Run release tests and verify RED**

Run: `node --test scripts/verify-android-release.test.mjs`

Expected: FAIL because the Android release verifier and workflow are absent.

- [ ] **Step 3: Implement signed APK workflow and user documentation**

The workflow must:

1. Run on pull requests, `main`, manual dispatch, and coordinated `workflow_call`; do not publish independently on tag pushes.
2. Install Node 22, Java 21, and the Android SDK.
3. Run `npm ci`, TypeScript/Vitest Android tests, `npm run android:sync`, Gradle unit tests, and lint.
4. For a coordinated release, decode the keystore into the runner temp directory, build one universal APK without ABI splits or `abiFilters`, run `apksigner verify --print-certs`, rename it deterministically, and write `sha256sum` output.
5. Upload an Actions artifact on every successful build.
6. Upload the APK and digest as a validated Actions artifact; the tag coordinator publishes it only with the complete validated desktop set.

Change the desktop workflow's existing Release cleanup loop to match only
`Codex-Pet-Pause-*-mac-*.dmg`, `Codex-Pet-Pause-*-windows-*.exe`,
`Codex-Pet-Pause-*-linux-*.AppImage`, and `Codex-Pet-Pause-*-linux-*.deb`.
Extend `verify-desktop-workflow.test.mjs` with an Android fixture asset and assert
that the cleanup filter does not select it. This is a release-safety correction;
desktop build matrices, commands, artifact names, and binaries stay unchanged.

Do not configure ABI splits or `abiFilters`: the app has no native `.so` libraries, so its
pure-JVM/WebView APK is universal and arm64 compatible. Bump the shared application version
to `0.3.0` before creating tag `v0.3.0`.

Document sideload installation, unknown-source permission, notification and
overlay permission, the persistent service notification, Show Pet, Hide Pet,
Quit, local persistence, update behavior, and Android power-management guidance
in complete Chinese and English.

- [ ] **Step 4: Run the complete release gate GREEN**

Run:

```bash
npm run typecheck
npm run test:run
npm run android:test:native
npm run android:build:web
npm run android:sync
cd android && ./gradlew lintDebug assembleDebug && cd ..
node --test scripts/verify-android-release.test.mjs scripts/verify-desktop-workflow.test.mjs
npm run check:desktop-release
```

Expected: all TypeScript, Android native, Android build, web, Electron, desktop
packaging, Playwright, localization, import security, and release tests pass.

- [ ] **Step 5: Perform device acceptance before publishing**

Install the signed APK on one physical arm64 phone. Verify: fresh onboarding,
permission denial/retry, medium default size, single tap, lag-free drag, double
tap menu, edge snap without automatic hiding, second outward swipe retraction,
restore, full hide/notification restore, Activity closure, two queued reminders,
custom reminder, reboot recovery, ZIP import, Petdex immediate preview, active
pet switching, custom-pet system sound, relaunch persistence, portrait, and
landscape. Record Android version and results in the release PR.

- [ ] **Step 6: Commit release automation and documentation**

```bash
git add .github/workflows/build-android.yml .github/workflows/build-desktop.yml scripts/verify-android-release.mjs scripts/verify-android-release.test.mjs scripts/verify-desktop-workflow.test.mjs docs/ANDROID-INSTALL.md docs/ANDROID-INSTALL.zh-CN.md README.md README.zh-CN.md package.json package-lock.json
git commit -m "build: package signed Android releases"
```

## Final Review Checklist

- [ ] Android code is reachable only through the Android build host and Android package.
- [ ] Electron files and desktop CSS have no Android-specific branches.
- [ ] The pet stays where placed and snaps only after an edge drag.
- [ ] An attached pet retracts only after a second outward swipe.
- [ ] Buttons fit the safe phone area and no reminder action requires scrolling.
- [ ] Settings and imported pets survive Activity closure, service restoration, relaunch, and upgrade.
- [ ] The APK is signed, universal, reproducibly named, and accompanied by SHA-256.
- [ ] The complete existing desktop release gate passes before tagging.

Android backup is disabled for app-private settings, history, reminder state, and imported pets; same-key in-place APK upgrades still preserve local data.
