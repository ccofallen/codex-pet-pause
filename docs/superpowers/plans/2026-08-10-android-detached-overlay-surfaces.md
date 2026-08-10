# Android Detached Overlay Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Android pet window pixel-stable while independent menu and reminder windows open and close, and reliably open reminders when a tap occurs at the displayed deadline.

**Architecture:** `PetOverlayService` continues to own the existing small pet WebView and its gestures. A new `DetachedOverlaySurfaceController` owns one optional second WebView for MENU or BUBBLE, positions it beside the pet, and never mutates pet layout parameters. The Android overlay frontend gains a surface-only entry that renders no pet DOM.

**Tech Stack:** Kotlin, Android WindowManager, Android WebView, React 19, TypeScript, Vitest, Robolectric, AndroidX instrumentation.

## Global Constraints

- Android-only behavior change; Electron and web behavior must remain unchanged.
- Do not change persisted state schemas, Petdex storage, imported pet assets, reminder intervals, or activity history.
- Do not resize, reposition, recreate, translate, or hide the pet window when MENU or BUBBLE changes.
- MENU and BUBBLE are mutually exclusive and use one detached surface window.
- Invalid sizes and stale generations never reach WindowManager.
- No git commands are part of this execution plan.
- Existing Android release signing and package identity remain unchanged.

## File Structure

- Create `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/DetachedSurfaceGeometry.kt`: pure placement and clamping.
- Create `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/DetachedOverlaySurfaceController.kt`: detached WebView lifecycle and WindowManager ownership.
- Create `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/DetachedSurfaceGeometryTest.kt`: left/right/safe-bounds contracts.
- Create `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/DetachedOverlaySurfaceControllerTest.kt`: one-window lifecycle, generations, recovery, and no pet mutations.
- Create `src/android/components/AndroidDetachedSurfaceApp.tsx`: surface-only React renderer.
- Create `src/android/components/AndroidDetachedSurfaceApp.test.tsx`: no-pet DOM, actions, and intrinsic measurement.
- Modify `src/main.android.tsx`: select pet or detached renderer from the Android-only query string.
- Modify `src/android/components/AndroidOverlayStage.tsx`: return to pet-only responsibilities.
- Modify `src/android/components/AndroidOverlayApp.tsx`: remove menu/bubble rendering ownership after migration.
- Modify `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`: provide a surface-only URL/factory contract and typed detached messages.
- Modify `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`: integrate controller and deadline reconciliation without resizing the pet.
- Modify `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`: enforce unchanged pet layout parameters and deadline behavior.
- Modify `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/OverlayGestureTest.kt`: pixel-stable left/right menu tests.
- Modify `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/ReminderFlowTest.kt`: pixel-stable bubbles and zero-second tap.
- Modify `src/styles/android-overlay.css`: surface-only styles scoped to the Android detached renderer.

---

### Task 1: Pure Detached Surface Geometry

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/DetachedSurfaceGeometry.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/DetachedSurfaceGeometryTest.kt`

**Interfaces:**
- Produces: `DetachedSurfaceSide`, `DetachedSurfaceSize`, and `DetachedSurfaceGeometry.place(anchor: OverlayPlacement, surface: DetachedSurfaceSize, screen: Bounds): OverlayPlacement`.
- Rule: returned placement describes only the detached window and never modifies the supplied pet placement.

- [ ] **Step 1: Write failing geometry tests**

Cover a left pet, right pet, top/bottom clamping, oversized surfaces, and exact preservation of the input `OverlayPlacement`.

```kotlin
@Test fun rightPetPlacesSurfaceToTheLeftWithoutMutatingAnchor() {
    val anchor = OverlayPlacement(320, 600, 72, Attachment.Free)
    val result = DetachedSurfaceGeometry.place(anchor, DetachedSurfaceSize(208, 260), Bounds(400, 800))
    assertEquals(104, result.x)
    assertEquals(anchor, OverlayPlacement(320, 600, 72, Attachment.Free))
}
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
cd android
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME=$PWD/../.gradle-user-home ./gradlew --no-daemon :app:testDebugUnitTest --tests io.elevenlabs.codexpetpause.overlay.DetachedSurfaceGeometryTest
```

Expected: compilation failure because `DetachedSurfaceGeometry` does not exist.

- [ ] **Step 3: Implement the pure geometry**

Use the existing `SURFACE_GAP_DP`, screen bounds, and pet center to choose a side. Clamp width and height before calculating x/y. Do not write to service state.

- [ ] **Step 4: Run the geometry test and verify GREEN**

Expected: all geometry cases pass with no Android service or WebView required.

### Task 2: Surface-Only React Renderer

**Files:**
- Create: `src/android/components/AndroidDetachedSurfaceApp.tsx`
- Create: `src/android/components/AndroidDetachedSurfaceApp.test.tsx`
- Modify: `src/main.android.tsx`
- Modify: `src/styles/android-overlay.css`

**Interfaces:**
- Consumes native events: `state-changed`, `open-menu`, `show-reminder`, `close-surface`.
- Produces native messages: `surface-ready`, `surface-size-changed`, `surface-action`, each with `mode` and `generation`.
- Query contract: `?overlay=surface` renders `AndroidDetachedSurfaceApp`; the existing `?overlay=1` continues to render the pet app during migration.

- [ ] **Step 1: Write failing component tests**

Assert that surface mode contains no `android-pet`, MENU emits close/settings/hide/quit actions, BUBBLE emits complete/skip/snooze, and intrinsic measurements include mode and generation.

```tsx
expect(screen.queryByTestId('android-pet')).not.toBeInTheDocument();
expect(postMessage).toHaveBeenCalledWith({
  type: 'surface-size-changed', mode: 'BUBBLE', generation: 4, widthDp: 208, heightDp: 260,
});
```

- [ ] **Step 2: Run the new Vitest file and verify RED**

```bash
npm run test:run -- src/android/components/AndroidDetachedSurfaceApp.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the surface renderer**

Move only MENU and BUBBLE markup into `AndroidDetachedSurfaceApp`. Keep reminder copy and actions identical. Scope CSS under `[data-android-detached-surface='true']`; do not alter desktop or web selectors.

- [ ] **Step 4: Run component tests and typecheck**

```bash
npm run test:run -- src/android/components/AndroidDetachedSurfaceApp.test.tsx src/android/components/AndroidOverlayStage.test.tsx src/android/components/AndroidReminderBubble.test.tsx
npm run typecheck
```

Expected: detached tests pass and existing Android pet tests remain green.

### Task 3: Detached Window Controller

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/DetachedOverlaySurfaceController.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/DetachedOverlaySurfaceControllerTest.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/OverlayJavascriptBridgeTest.kt`

**Interfaces:**
- Constructor dependencies: `WindowManager`, surface WebView factory, screen-bounds provider, anchor provider, and `onAction` callback.
- Produces methods: `openMenu(generation)`, `openBubble(generation)`, `applyMeasurement(mode, generation, widthDp, heightDp)`, `close(expectedGeneration?)`, `reflow()`, `destroy()`, and `recoverRenderer(failedView, generation)`.
- Exposes read-only `activeSurface: DetachedSurfaceState?` for service decisions and tests.

- [ ] **Step 1: Write failing lifecycle tests**

Use separate fake WindowManager records for pet and surface. Assert one detached add, measurement updates only the surface record, replacement closes the previous generation, stale events do nothing, and close removes exactly one surface view.

```kotlin
assertEquals(petParamsBefore, petParamsAfter)
assertEquals(1, surfaceWindowManager.removeCount)
```

- [ ] **Step 2: Run controller tests and verify RED**

Expected: compilation failure because the controller does not exist.

- [ ] **Step 3: Implement typed bridge and controller**

Load `https://appassets.androidplatform.net/app/index.html?overlay=surface`. Reject messages without the active generation. MENU starts with its fixed intrinsic dimensions; BUBBLE waits for a valid measured size. Keep all controller callbacks on the main looper.

- [ ] **Step 4: Add renderer recovery cases**

Test failed-view identity, generation identity, one queued replacement, close-before-replacement cancellation, and no pet-window calls during recovery.

- [ ] **Step 5: Run controller and bridge tests**

Expected: all detached controller and message parsing tests pass.

### Task 4: Service Integration and Deadline Race

**Files:**
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`

**Interfaces:**
- Consumes `DetachedOverlaySurfaceController` from Task 3.
- Pet `layoutParams` remain `placement.sizeDp × placement.sizeDp` in PET, MENU, and BUBBLE states.
- A single tap calls existing reminder reconciliation before `overlayTapAction`.

- [ ] **Step 1: Write failing service tests**

Capture a copy of pet layout parameters, open and close MENU, open and close BUBBLE, and assert x/y/width/height and pet `updateViewLayout` count are unchanged. Add clock-boundary cases where due-at equals now and now-minus-one.

- [ ] **Step 2: Run service tests and verify RED**

Expected: existing service resizes the pet window and the deadline tap is classified as `PET_INTERACTION`.

- [ ] **Step 3: Integrate detached surfaces**

Replace surface calls to `updateSurfaceBounds` with controller calls. Keep `updateSurfaceBounds` private to pet size/display reflow only, then rename it to `updatePetBounds` to prevent future misuse.

- [ ] **Step 4: Implement deadline reconciliation**

On single tap, call the existing idempotent reminder reconciliation path, refresh the snapshot, then inspect `pendingQueue`. If reconciliation fails, preserve the pending reminder and reschedule recovery rather than treating the tap as a reminder-free interaction.

- [ ] **Step 5: Run service tests and focused TypeScript tests**

Expected: unchanged pet parameters, exact-deadline BUBBLE action, and pre-deadline pet interaction.

### Task 5: Remove Legacy Combined-Surface Ownership

**Files:**
- Modify: `src/android/components/AndroidOverlayApp.tsx`
- Modify: `src/android/components/AndroidOverlayStage.tsx`
- Modify: `src/android/components/AndroidOverlayApp.test.tsx`
- Modify: `src/android/components/AndroidOverlayStage.test.tsx`
- Modify: `src/android/components/AndroidReminderBubble.test.tsx`

**Interfaces:**
- Pet renderer accepts only state, placement, tap, and drag events.
- Detached renderer from Task 2 owns all MENU/BUBBLE DOM and actions.

- [ ] **Step 1: Write tests rejecting combined surfaces**

Assert `AndroidOverlayStage` never renders menu or dialog even if legacy events are injected into the pet renderer. Assert pet tap/drag animations remain unchanged.

- [ ] **Step 2: Remove legacy menu/bubble state and markup**

Delete only migrated state, events, effects, and markup. Preserve pet selection, asset loading, animation, locale data, and state snapshot parsing.

- [ ] **Step 3: Run all Android component tests and typecheck**

Expected: surface-only tests own menu/bubble coverage; pet component tests retain interaction coverage.

### Task 6: Instrumented Pixel-Stability and Lifecycle Tests

**Files:**
- Modify: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/OverlayGestureTest.kt`
- Modify: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/ReminderFlowTest.kt`

**Interfaces:**
- Uses accessibility window records to distinguish the fixed pet window from the detached surface window by bounds and active mode.

- [ ] **Step 1: Add right/left MENU tests**

Record the pet `Rect` before open, while MENU is visible, and after close. Repeat ten times per side and assert all recorded rectangles equal the baseline exactly.

- [ ] **Step 2: Add right/left BUBBLE tests**

Repeat the same exact-bound checks for open, complete/skip/snooze, next reminder, and close.

- [ ] **Step 3: Add exact-deadline tap test**

Persist a reminder with `nextDueAt` equal to the controlled clock, tap the pet before the timer callback is allowed to run, and assert BUBBLE appears.

- [ ] **Step 4: Add lifecycle and renderer cases**

Verify hide/show, background/foreground, rotation, pet renderer loss, surface renderer loss, and close-during-recovery without duplicate windows.

- [ ] **Step 5: Run the two instrumented classes**

```bash
cd android
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME=$PWD/../.gradle-user-home ./gradlew --no-daemon :app:connectedDebugAndroidTest
```

Expected: all instrumented tests pass, with zero-pixel pet displacement.

### Task 7: Full Regression and APK

**Files:**
- Output: `release/Codex-Pet-Pause-0.3.1-android-detached-surfaces-tested.apk`
- Output: `.superpowers/sdd/2026-08-10-android-detached-surfaces/final-report.md`

- [ ] **Step 1: Run complete frontend verification**

```bash
npm run test:run
npm run typecheck
```

Expected: every test file passes and typecheck emits no diagnostics.

- [ ] **Step 2: Sync Android assets and run the full Android gate**

```bash
npm run android:sync
cd android
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME=$PWD/../.gradle-user-home ./gradlew --no-daemon test lint assembleDebug connectedAndroidTest assembleRelease --console=plain
```

Expected: `BUILD SUCCESSFUL` with all instrumentation cases passing.

- [ ] **Step 3: Install and exercise the release APK**

Install the exact release file, launch it from the launcher icon, perform ten menu and ten bubble cycles on both edges, complete consecutive reminders, drag/snap/retract/restore, change all three sizes, open Petdex, and background/foreground the app.

- [ ] **Step 4: Audit process and logs**

Reject release for any app-owned fatal exception, ANR, OOM, renderer loop, duplicate overlay window, stale detached window, or pet-bound change.

- [ ] **Step 5: Produce non-overwriting artifact and hash**

```bash
cp android/app/build/outputs/apk/release/app-release.apk release/Codex-Pet-Pause-0.3.1-android-detached-surfaces-tested.apk
shasum -a 256 release/Codex-Pet-Pause-0.3.1-android-detached-surfaces-tested.apk
```

Record test counts, exact pixel-bound evidence, release startup evidence, log audit, artifact path, and SHA-256 in the final report.
