# Task 6 Report: Native Android Reminder Delivery and Queue Recovery

## Status

GREEN for the Task 6 focused renderer, accepted queue/action regression,
TypeScript typecheck, focused ReminderEngine native/Robolectric, and complete
native unit/Robolectric gates.

Base SHA: `5dd4cae64b623734cd9aa5da22c3592805ab9f6e`

Implementation commit: `dc52d4aa9cfe59d8ef1e6437821cc0d0cfe128d2`

`assembleDebug` is explicitly deferred to Task 9/10. A pre-resume attempt
crossed the bounded wait during resource merging and was terminated with exit
130; it was not rerun after the user assigned device/APK packaging to Task
9/10.

## Implementation

- Added a native `ReminderEngine` that reloads Task 2 state for every reconcile
  and action, repairs stale countdowns from persisted settled history, persists
  absolute due times, handles pause/quiet suppression, and rebuilds a stable
  `(dueAt, id)` queue after process recovery.
- Added one atomic Task 2 coordinator mutation for reminder actions so settings
  and completion, snooze, or skip history enter the same `state.json` write.
- Added a coroutine live timer and an inexact
  `AlarmManager.setAndAllowWhileIdle` backup. Scheduling is re-derived after
  reconciliation and action transitions; service teardown cancels only the
  live timer while the process-recovery alarm remains.
- Added a conditionally enabled `BootReceiver` for boot, package replacement,
  clock, timezone, and backup-alarm recovery. No exact-alarm permission is
  declared or requested.
- Extended the existing Task 5 `PetOverlayService`, WebView bridge, and React
  renderer instead of adding a second service or renderer. Native show/close
  events and typed completion, snooze, and skip messages preserve one bubble at
  a time and transition directly to the next queued reminder.
- Added a measured, content-sized bilingual Android reminder bubble with all
  primary actions available without an intermediate close/confirmation layer.
- Added immutable cat-sound and system-sound notification channels. The built-in
  cat uses the packaged `cat_meow` resource; imported Codex pets use the system
  notification sound.
- Added Android 13+ notification permission detection and manifest declaration
  without requesting permission. Task 7 remains responsible for onboarding and
  permission education.

## Files

- `android/app/build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateCoordinator.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/BootReceiver.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderEngine.kt`
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactory.kt`
- `android/app/src/main/res/raw/cat_meow.wav`
- `android/app/src/test/java/io/elevenlabs/codexpetpause/reminders/ReminderEngineTest.kt`
- `src/android/components/AndroidOverlayApp.tsx`
- `src/android/components/AndroidOverlayStage.tsx`
- `src/android/components/AndroidReminderBubble.test.tsx`
- `src/styles/android-overlay.css`

## TDD RED Evidence

1. Command:
   `JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk ./gradlew testDebugUnitTest --tests '*ReminderEngineTest'`
   Result: failed at Kotlin test compilation with unresolved
   `ReminderClock`, `ReminderEngine`, queue transitions, delivery scheduler,
   notification factory, and sound contracts.
2. Command:
   `npm run test:run -- src/android/components/AndroidReminderBubble.test.tsx`
   Result: 1 file failed, 5 tests failed. The existing renderer selected settings
   order rather than deterministic due order, exposed no primary actions or
   typed reminder mutations, did not resize after intrinsic action changes, and
   ignored native show/close events.

The first sandboxed invocations failed before reaching tests because Vite and
Gradle could not write their normal cache files. Both commands were rerun with
the required workspace permissions; only the intended missing-feature failures
above are counted as RED.

## GREEN Evidence

1. Focused renderer:
   `npm run test:run -- src/android/components/AndroidReminderBubble.test.tsx`
   Result: 1 file passed, 5 tests passed.
2. Accepted queue/action regression gate:
   `npm run test:run -- src/android/components/AndroidReminderBubble.test.tsx src/features/cat/components/CatReminderBubble.test.tsx src/features/reminders/components/ActionCard.test.tsx`
   Result: 3 files passed, 38 tests passed.
3. TypeScript:
   `npm run typecheck`
   Result: exit 0.
4. Focused native/Robolectric:
   `JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk ./gradlew testDebugUnitTest --tests '*ReminderEngineTest'`
   Result: `BUILD SUCCESSFUL` in 3 seconds.
5. Complete native unit/Robolectric:
   `JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk ./gradlew testDebugUnitTest`
   Result: `BUILD SUCCESSFUL` in 3 seconds.

## Remaining Risks

- Real-device notification permission, channel sound, `WindowManager`, alarm,
  boot, OEM power-management, and background-start behavior are not covered by
  JVM/Robolectric alone. Task 9 instrumentation and Task 10 device acceptance
  own those checks.
- `assembleDebug` was not completed in this task after the bounded resource-merge
  timeout and explicit deferment. Task 9/10 owns APK/device packaging validation.
- Android onboarding still does not request or explain notification/overlay
  permissions; that remains intentionally scoped to Task 7.
- Gradle retains the existing `flatDir` metadata warning.
- The report and implementation intentionally exclude `release/`,
  `dist-android/`, generated Capacitor Gradle files, and the main progress ledger.
