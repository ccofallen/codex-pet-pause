# Android Overlay Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android pet overlay deterministic, state-synchronized, system-sounding, and visually consistent with the desktop brand.

**Architecture:** Keep native Android authoritative for surface mode and geometry. Add generation-tagged bubble measurements, separate position updates from dimension transitions, publish native visibility changes to the Capacitor UI, and use new system-default notification channels.

**Tech Stack:** Kotlin, Android WindowManager, Capacitor, React, TypeScript, Vitest, Robolectric/JUnit, Android instrumentation tests, Gradle.

## Global Constraints

- Android-only production changes; do not alter macOS, Windows, or Linux behavior.
- Hidden state has priority over reminder presentation.
- `PET` and `MENU` dimensions are native-owned; only `BUBBLE` accepts validated renderer measurements.
- All sound-enabled Android reminders use the Android system default notification sound.
- Existing local settings and imported pets remain compatible.
- Use test-driven development for each behavior change.

---

### Task 1: Make the overlay protocol mode- and generation-aware

**Files:**
- Modify: `src/android/domain/overlayProtocol.ts`
- Modify: `src/android/components/AndroidOverlayStage.tsx`
- Modify: `src/android/components/AndroidOverlayStage.test.tsx`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`

**Interfaces:**
- Consumes: native surface mode transitions and WebView bridge messages.
- Produces: `OverlaySurfaceDescriptor(mode, generation)` and `bubble-size-changed` messages containing `mode`, `generation`, `widthDp`, and `heightDp`.

- [ ] **Step 1: Add failing renderer tests**

Assert that the menu emits no size report and that a bubble report includes the active `BUBBLE` mode and generation received in the native open command.

- [ ] **Step 2: Run the focused renderer test and confirm failure**

Run: `npm test -- --run src/android/components/AndroidOverlayStage.test.tsx`

Expected: FAIL because the current generic size message has no mode or generation and is also emitted for the menu.

- [ ] **Step 3: Add failing service tests**

Cover these exact transitions:

```kotlin
service.openMenu()
service.receiveSize(mode = "BUBBLE", generation = service.generation - 1, width = 72, height = 72)
assertEquals(SurfaceMode.MENU, service.surfaceMode)
assertEquals(expectedMenuBounds, service.bounds)

service.openReminderBubble()
service.receiveSize(mode = "BUBBLE", generation = service.generation, width = 280, height = 340)
assertEquals(SurfaceMode.BUBBLE, service.surfaceMode)
assertEquals(Size(280, 340), service.bounds.size)
```

- [ ] **Step 4: Run the focused service test and confirm failure**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PetOverlayServiceTest*'`

Expected: FAIL because stale and menu-originated messages are currently accepted.

- [ ] **Step 5: Implement the typed protocol**

Add an incrementing generation to native mode transitions, include it in `open-menu` and `open-reminder` commands, and accept a resize only when current mode, message mode, and generation are all `BUBBLE` and equal. Remove renderer measurement from the menu path.

- [ ] **Step 6: Run both focused suites**

Run: `npm test -- --run src/android/components/AndroidOverlayStage.test.tsx && cd android && ./gradlew testDebugUnitTest --tests '*PetOverlayServiceTest*'`

Expected: PASS.

### Task 2: Separate position updates from dimension changes

**Files:**
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayGeometry.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`
- Modify: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceInstrumentedTest.kt`

**Interfaces:**
- Consumes: drag placements and explicit surface transitions.
- Produces: `updateOverlayPosition(xPx, yPx)` and `transitionSurface(mode, widthDp, heightDp)` with non-overlapping responsibilities.

- [ ] **Step 1: Add a failing unit test for drag stability**

Capture window dimensions, apply several drag placements, and assert every placement changes only `x` and `y` while width and height remain unchanged.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PetOverlayServiceTest*drag*'`

Expected: FAIL because dragging currently reapplies surface bounds.

- [ ] **Step 3: Implement position-only WindowManager updates**

Move dimension calculation into mode transitions. Make drag, edge snap, and display reflow call the position-only path unless the persisted pet-size setting itself changed.

- [ ] **Step 4: Add an instrumentation repetition test**

Run at least 20 cycles of open menu, close menu, drag, and return to pet. Assert the final overlay dimensions equal the selected pet-size dimensions on every cycle.

- [ ] **Step 5: Run unit and connected tests**

Run: `cd android && ./gradlew testDebugUnitTest connectedDebugAndroidTest`

Expected: PASS when an Android device or emulator is connected.

### Task 3: Make hidden state authoritative and synchronize the app page

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/PetVisibilityBus.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/PetVisibilityBusTest.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostLifecycle.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidHostLifecycleTest.kt`
- Modify: `src/android/components/AndroidOnboarding.test.tsx`

**Interfaces:**
- Consumes: service and plugin visibility transitions.
- Produces: process-local `PetVisibilityBus.publish(visible: Boolean)` events forwarded as Capacitor `capabilitiesChanged` events.

- [ ] **Step 1: Add failing tests for hide precedence**

Simulate a due reminder followed by hide and assert the overlay remains absent while reminder notification reconciliation continues.

- [ ] **Step 2: Add failing state-bus tests**

Assert one published transition updates subscribers, duplicate values are suppressed, and an unsubscribed listener receives no future updates.

- [ ] **Step 3: Add a failing React capability test**

Start with `petVisible: true`, dispatch a native capability event with `petVisible: false`, and assert the action text becomes `Show pet` without remounting.

- [ ] **Step 4: Run focused tests and confirm failure**

Run: `npm test -- --run src/android/components/AndroidOnboarding.test.tsx && cd android && ./gradlew testDebugUnitTest --tests '*PetVisibilityBusTest*' --tests '*AndroidHostLifecycleTest*' --tests '*PetOverlayServiceTest*'`

Expected: FAIL because menu-driven service state is not broadcast and reminder reconciliation can reveal hidden UI.

- [ ] **Step 5: Implement shared native visibility state**

Publish after every effective visibility transition, subscribe while the plugin is active, emit a full capability snapshot, and prevent `openReminderBubble()` from showing a hidden overlay. Keep posting/scheduling the system notification.

- [ ] **Step 6: Run the focused tests**

Run: `npm test -- --run src/android/components/AndroidOnboarding.test.tsx && cd android && ./gradlew testDebugUnitTest`

Expected: PASS.

### Task 4: Standardize Android reminder audio

**Files:**
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactory.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactoryTest.kt`
- Modify: `src/application/reminders/ReminderEngineTest.ts`
- Modify: `src/features/reminders/application/ReminderFlowTest.ts`

**Interfaces:**
- Consumes: `soundEnabled` from reminder settings.
- Produces: a new immutable Android notification channel ID using the system default sound for every sound-enabled pet.

- [ ] **Step 1: Change tests to require system sound for every pet source**

Assert built-in and imported pets select the same new system-default channel; assert disabled sound selects the silent channel.

- [ ] **Step 2: Run focused notification tests and confirm failure**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*ReminderNotificationFactoryTest*'`

Expected: FAIL because the built-in cat currently selects the custom cat channel.

- [ ] **Step 3: Implement the new channel version**

Create a new channel such as `reminders-system-v2` with `Settings.System.DEFAULT_NOTIFICATION_URI`, route all enabled sounds to it, and leave the existing channel IDs untouched for upgrade compatibility.

- [ ] **Step 4: Run Android and shared reminder tests**

Run: `cd android && ./gradlew testDebugUnitTest && cd .. && npm test -- --run src/application/reminders/ReminderEngineTest.ts src/features/reminders/application/ReminderFlowTest.ts`

Expected: PASS with no web-audio duplication on Android.

### Task 5: Align Android launcher and notification branding

**Files:**
- Modify: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Modify: `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Modify: `android/app/src/main/res/drawable/ic_launcher_foreground.xml`
- Create: `android/app/src/main/res/drawable/ic_notification.xml`
- Modify: Android legacy launcher files under `android/app/src/main/res/mipmap-*`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactory.kt`

**Interfaces:**
- Consumes: canonical artwork from `build/brand/codex-pet-pause-icon.svg`.
- Produces: adaptive, legacy, and monochrome Android cat icons.

- [ ] **Step 1: Add an Android resource contract test**

Assert the manifest launcher resource, adaptive foreground/background resources, and notification small icon all resolve and no longer reference generic Capacitor artwork.

- [ ] **Step 2: Run the resource test and confirm failure**

Run: `cd android && ./gradlew testDebugUnitTest`

Expected: FAIL because current resources contain the generic launcher artwork and notification icon path.

- [ ] **Step 3: Generate Android resources from the canonical SVG**

Preserve the brown background and gold cat outline, fit the cat inside the adaptive safe zone, generate required legacy densities, and use a single-color cat silhouette for `ic_notification`.

- [ ] **Step 4: Run resource and build checks**

Run: `cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug`

Expected: PASS and produce an installable debug APK.

### Task 6: Full regression and device acceptance

Before full regression, add focused tests for Android pet animation mapping and Petdex same-origin blob ZIP acceptance/rejection. Verify a completed Petdex transfer finishes the isolated activity so the import preview is immediately visible.

**Files:**
- Modify only if a test exposes a defect in files already listed above.

**Interfaces:**
- Consumes: completed Android fixes.
- Produces: verified debug APK and release-ready evidence.

- [ ] **Step 1: Run the complete TypeScript suite**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Run the production web build**

Run: `npm run build`

Expected: TypeScript and Vite production build pass.

- [ ] **Step 3: Run complete Android verification**

Run: `cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug`

Expected: all tasks succeed.

- [ ] **Step 4: Run connected Android acceptance tests**

Run: `cd android && ./gradlew connectedDebugAndroidTest`

Expected: all tests pass on the connected device/emulator.

- [ ] **Step 5: Perform manual device acceptance**

Verify small, medium, and large sizes; 20 menu cycles; drag and edge snap; hide from menu; app button state; hidden due reminder; system sound; launcher artwork; and imported-pet persistence.

- [ ] **Step 6: Confirm desktop isolation**

Review the final changed-file list and confirm no desktop runtime file changed. Run the existing desktop build only as a compilation regression check.
