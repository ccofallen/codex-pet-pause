# Android Stability, Petdex Assets, and Compact Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate size-change work and contain WebView failures, render Petdex's official pet images, and reduce the normal Android top area to two compact controls.

**Architecture:** Use the existing in-process overlay refresh bus as the primary delivery path and invoke the service command only when no listener exists. Run Petdex in a private WebView process with an exact-origin subresource policy and filesystem archive handoff. Add single-shot renderer recovery at the Petdex, overlay, and Capacitor boundaries while preserving all desktop/web paths.

**Tech Stack:** React 19, TypeScript, Vitest, Capacitor 8, Android API 28+, Kotlin/Java, Android WebView, Robolectric, Android instrumentation.

## Global Constraints

- Android-only behavior changes; Electron desktop and normal web behavior remain unchanged.
- Petdex main-frame navigation remains restricted to exact HTTPS `petdex.dev`.
- Only exact HTTPS `assets.petdex.dev` is added for official Petdex subresources.
- ZIP MIME, name, path, redirect, byte-size, and origin validation remain intact.
- Normal top state contains exactly the two localized pet-visibility and quit controls.
- Permission onboarding retains the instructions required to grant access.
- Renderer recovery is single-shot per renderer instance and must not loop.
- Do not use git or create commits during this implementation.
- Every production change starts with a focused failing regression.

---

### Task 1: Deliver one overlay refresh per committed mutation

**Files:**
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayStateRefreshBus.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidCommittedMutationEffectsTest.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayStateRefreshBusTest.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`

**Interfaces:**
- Consumes: `PetOverlayStateRefreshBus.publish(): Int`, `AndroidOverlayRefreshRetrier.refresh(): Throwable?`.
- Produces: `internal fun deliverOverlayRefresh(publish: () -> Int, fallback: () -> Throwable?): Throwable?`.

- [ ] **Step 1: Write failing delivery-arbitration tests**

```kotlin
@Test fun liveOverlayListenerSuppressesServiceFallback() {
    var fallbacks = 0
    val warning = deliverOverlayRefresh(publish = { 1 }, fallback = { fallbacks += 1; null })
    assertNull(warning)
    assertEquals(0, fallbacks)
}

@Test fun absentOverlayListenerUsesServiceFallback() {
    var fallbacks = 0
    deliverOverlayRefresh(publish = { 0 }, fallback = { fallbacks += 1; null })
    assertEquals(1, fallbacks)
}
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run the bridge/bus/service test classes. Expected: tests fail because `deliverOverlayRefresh` does not exist and normal mutation delivery invokes both paths.

- [ ] **Step 3: Implement single-path delivery**

```kotlin
internal fun deliverOverlayRefresh(
    publish: () -> Int,
    fallback: () -> Throwable?,
): Throwable? = if (publish() > 0) null else fallback()
```

Use this helper in `AndroidHostPlugin.complete()` so the service retrier runs only when the bus reports zero listeners.

- [ ] **Step 4: Add size-change integration assertions**

Assert that one committed size mutation causes one `refreshState()` observation and one bounds transition, while an inactive service still receives the command fallback.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: all bridge, refresh-bus, retrier, and overlay-service tests pass with one delivery per mutation.

---

### Task 2: Isolate Petdex and allow official image assets

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexProcessServiceWorkerPolicy.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/petdex/PetdexActivitySecurityTest.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/petdex/PetdexServiceWorkerLifetimeTest.kt`
- Test: `src/android/infrastructure/petdexIsolation.test.ts`

**Interfaces:**
- Produces: `PetdexSecurityPolicy.isAllowedSubresource(url: String): Boolean`.
- Produces: `PetdexWebViewProcess.configureDataDirectory(): Unit`, idempotent before first Petdex WebView construction.

- [ ] **Step 1: Write failing exact-origin policy tests**

```kotlin
@Test fun officialAssetsAreSubresourcesButNeverPages() {
    val preview = "https://assets.petdex.dev/pets/boba/preview.webp"
    assertTrue(PetdexSecurityPolicy.isAllowedSubresource(preview))
    assertFalse(PetdexSecurityPolicy.isAllowedPage(preview))
}

@Test fun lookalikeAndInsecureAssetsRemainBlocked() {
    assertFalse(PetdexSecurityPolicy.isAllowedSubresource("http://assets.petdex.dev/p.png"))
    assertFalse(PetdexSecurityPolicy.isAllowedSubresource("https://assets.petdex.dev.evil.test/p.png"))
    assertFalse(PetdexSecurityPolicy.isAllowedSubresource("https://user@assets.petdex.dev/p.png"))
}
```

- [ ] **Step 2: Write failing process/cache tests**

Assert that the manifest gives `PetdexActivity` `android:process=":petdex"`, the activity configures the `petdex` data-directory suffix before `WebView(this)`, and approved resources use `LOAD_DEFAULT` rather than `LOAD_NO_CACHE`.

- [ ] **Step 3: Run focused tests and verify RED**

Expected: official asset request, isolated-process, suffix, and cache assertions fail.

- [ ] **Step 4: Implement separated page/subresource policy**

```kotlin
fun isAllowedSubresource(url: String): Boolean =
    isAllowedOrigin(url) || isAllowedAssetOrigin(url)
```

Use `isAllowedSubresource` only from `shouldInterceptRequest`; keep `isAllowedPage` unchanged in navigation callbacks. Service Worker requests use the same exact-origin subresource decision instead of blocking every request.

- [ ] **Step 5: Implement process isolation and cache behavior**

Add `android:process=":petdex"`. On API 28+, call `WebView.setDataDirectorySuffix("petdex")` through an idempotent helper before constructing the WebView. Set `cacheMode = WebSettings.LOAD_DEFAULT`.

- [ ] **Step 6: Verify filesystem handoff remains process-safe**

Run pending-archive store/queue tests and add an instrumented open-download-return assertion proving that the main process discovers the atomically published archive after resume.

- [ ] **Step 7: Run focused tests and verify GREEN**

Expected: security, isolation, Service Worker, and archive handoff tests pass; unapproved origins still receive `403`.

---

### Task 3: Contain and recover WebView renderer loss

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/web/RendererRecoveryGate.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/web/RendererRecoveryGateTest.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/MainActivity.java`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/petdex/PetdexActivitySecurityTest.kt`

**Interfaces:**
- Produces: `RendererRecoveryGate.tryBegin(): Boolean`, true only once until a new gate/renderer is created.
- `OverlayWebViewFactory` accepts `onRendererGone: () -> Unit` in addition to `onMessage`.

- [ ] **Step 1: Write failing single-shot recovery tests**

```kotlin
@Test fun recoveryRunsOncePerRenderer() {
    val gate = RendererRecoveryGate()
    assertTrue(gate.tryBegin())
    assertFalse(gate.tryBegin())
}
```

Add overlay tests proving a dead WebView is removed and one replacement is scheduled only when lifecycle state says the pet remains visible.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: recovery gate and renderer callbacks do not exist.

- [ ] **Step 3: Implement Petdex renderer containment**

Override `onRenderProcessGone`, guard with a renderer-local gate, detach/destroy the unusable WebView, finish only `PetdexActivity`, and return `true`.

- [ ] **Step 4: Implement overlay renderer recovery**

Route `OverlayWebViewFactory.onRenderProcessGone` to the service. The service removes the dead view, clears its layout/dispatcher references, and posts exactly one `showOverlay()` when visibility and overlay permission remain valid.

- [ ] **Step 5: Implement Capacitor renderer recovery**

After `BridgeActivity` initialization, register a `WebViewListener`. On renderer loss, use a single-shot guard, finish the current activity, and relaunch the existing main intent once; return `true` so Capacitor does not leave the failure unhandled.

- [ ] **Step 6: Run focused tests and verify GREEN**

Expected: gate, Petdex, overlay, and MainActivity contract tests pass with no recovery loop or duplicate view/activity.

---

### Task 4: Reduce the top Android surface to two controls

**Files:**
- Modify: `src/android/components/AndroidCapabilityStatus.tsx`
- Modify: `src/android/components/AndroidOnboarding.tsx`
- Modify: `src/styles/android.css`
- Test: `src/android/components/AndroidOnboarding.test.tsx`
- Test: `src/android/components/AndroidApp.test.tsx`

**Interfaces:**
- Normal mode markup: `.android-service-actions` containing exactly two buttons.
- Setup mode markup: `.android-onboarding[data-mode="setup"]` with existing permission instructions.

- [ ] **Step 1: Write failing normal-state rendering tests**

```tsx
expect(screen.getByRole('button', { name: 'Hide pet' })).toBeVisible();
expect(screen.getByRole('button', { name: 'Quit app' })).toBeVisible();
expect(screen.queryByText('Closing settings does not stop reminders.')).not.toBeInTheDocument();
expect(screen.queryByText(/stored only on this device/i)).not.toBeInTheDocument();
expect(screen.getByTestId('android-service-actions').children).toHaveLength(2);
```

Repeat the assertion for Chinese labels and ensure no normal-state heading/status/background copy remains.

- [ ] **Step 2: Write failing layout and onboarding-preservation tests**

Assert two columns at narrow widths, 48px minimum touch height, compact padding, no card shadow/background in normal state, and continued permission copy when overlay access is denied.

- [ ] **Step 3: Run focused tests and verify RED**

Expected: capability and normal-state explanatory text remains and the large card style is still present.

- [ ] **Step 4: Implement the compact controls**

Remove unconditional capability heading/storage/reminder paragraphs. Render normal `AndroidOnboarding` as only the two action buttons; keep setup content and compact action errors. Scope the surface/card styling to setup mode and make normal controls a two-column compact row.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: English/Chinese normal states contain exactly two buttons; permission onboarding and host action behavior remain covered.

---

### Task 5: Full stability and release verification

**Files:**
- Modify only if a Task 1-4 regression is proven: affected Task 1-4 files and their focused tests.
- Test: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/OverlayGestureTest.kt`
- Test: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/PetImportPersistenceTest.kt`
- Create: `.superpowers/sdd/2026-08-09-android-stability-petdex-compact-controls/task-5-report.md`
- Create: `release/Codex-Pet-Pause-0.3.1-android-stability-petdex-tested.apk`

**Interfaces:**
- Final artifact SHA-256 is recorded in the report.
- Existing APK artifacts are not overwritten.

- [ ] **Step 1: Run full static and unit verification**

Run the full TypeScript suite and typecheck, Android unit tests, Android lint, and debug/release assembly. Record test counts and warnings separately from errors.

- [ ] **Step 2: Run 30-cycle pet-size stress**

On the emulator/device, cycle `small -> medium -> large` ten times through the actual settings UI. Assert one overlay refresh and one bounds update per save; capture frame timing, ANR/process-death logs, renderer-loss logs, and PSS before/after.

- [ ] **Step 3: Verify Petdex visually and functionally**

Open Petdex, assert at least one `assets.petdex.dev` preview has nonzero rendered dimensions, download one ZIP, return automatically, preview/import it, activate it, and verify the overlay uses the imported pet.

- [ ] **Step 4: Stress process and renderer lifecycle**

Open/close Petdex ten times, switch among all four app pages, background/foreground the app, and keep the overlay visible. Reject release on ANR, uncaught renderer termination, app process death, duplicate activities/views, or monotonic PSS growth exceeding 64 MiB from warm baseline; absolute PSS must stay below 256 MiB.

- [ ] **Step 5: Verify compact top controls**

Capture narrow and standard-width screenshots. Confirm only the two requested buttons appear in normal state and permission instructions still appear on a clean/denied-permission run.

- [ ] **Step 6: Build and hash the new APK**

Create `release/Codex-Pet-Pause-0.3.1-android-stability-petdex-tested.apk`, install it, launch it by icon, rerun the smoke flow, and record `shasum -a 256` in the report.

- [ ] **Step 7: Independent release review**

Review every Task 1-4 report and the final device evidence. Release only if no actionable correctness, security, performance, lifecycle, or desktop/web isolation finding remains.
