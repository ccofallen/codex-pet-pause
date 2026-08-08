# Task 7 Report: Android Permissions and Service Onboarding

## Status

GREEN for focused Task 7 renderer/bridge tests, the complete Android/i18n and
desktop capability regression gate, TypeScript typecheck, focused and complete
native unit/Robolectric tests, and a bounded isolated debug Android build.

Base SHA: `fd9a0bfb4e1178fe8167036ac2d05880edca6b4e`

The progress ledger remains unchanged for parent review.

## Permission Contract

- `SYSTEM_ALERT_WINDOW` is the only user grant required before the floating-pet
  service is first started or the pet is shown. Returning from Android settings
  never implies success: Capacitor `handleOnResume()` reads the current system
  state and emits a fresh `capabilitiesChanged` event.
- `POST_NOTIFICATIONS` is requested contextually only on Android 13 / API 33 and
  newer. API 28-32 report it as `notRequired` and never invoke a nonexistent
  runtime prompt. Notification denial does not incorrectly block an otherwise
  valid overlay start, but the UI keeps a clear warning and retry control.
- The current Task 6 reminder architecture uses persisted, inexact
  `JobScheduler` recovery. Task 7 does not declare or request exact-alarm,
  location, background-location, battery-optimization, or unrelated access.
- The existing Android 14 `specialUse` foreground-service permission, service
  type, and subtype property remain authoritative. The service is explicitly
  `stopWithTask=false`, and its required ongoing notification is built before
  foreground execution continues.

## Lifecycle and UI Behavior

- Added strict capability parsing and typed host methods for capabilities,
  notification prompting, overlay settings, Start, Show, Hide, and Quit.
- Added complete Chinese and English first-run explanations, denial recovery,
  phone-sized 48px controls, visible focus treatment, and background scheduling
  guidance. Settings and navigation remain usable throughout denial.
- Added localized native notification resources and deterministic Show Pet,
  Open Settings, and Quit actions in English and Simplified Chinese.
- Persisted desired service and pet visibility separately from Activity state.
  Closing/reopening settings does not stop reminders; Hide keeps the service and
  recovery active and survives service recreation; a sticky restart preserves
  the hidden state rather than unexpectedly showing the pet.
- Overlay revocation hides the surface while preserving an already-active
  reminder service. The resumed Activity exposes the retry path and never starts
  a first service session without overlay authorization.
- Quit persists an explicit no-recovery state, cancels live/job recovery,
  disables boot recovery, cancels reminder and foreground notifications,
  stops the service, and removes app tasks. Boot and stale scheduler paths check
  that state before scheduling. A later explicit Activity launch clears the
  quit latch and permits the user to start again.
- Moved the existing Android overlay menu labels into the translation catalog.
  This also resolves the pre-existing source-completeness failure without
  changing overlay menu semantics.
- Repaired one pre-existing Task 6 test fixture: it marked a disabled reminder
  `due` without enabling it and expected an incomplete dialog accessible name.
  The corrected fixture now exercises the existing reminder bubble contract.

## TDD RED Evidence

### TypeScript

Command:

`npm run test:run -- src/android/components/AndroidOnboarding.test.tsx src/android/components/AndroidApp.test.tsx src/android/bridge/androidHost.test.ts`

Result: expected RED. `AndroidOnboarding` was absent; `getCapabilities()` and
`subscribeCapabilities()` were undefined; denied Android settings exposed no
Retry Permission control. Three files failed, with 3 failed tests and one
missing-module suite.

### Native

Command:

`./gradlew testDebugUnitTest --tests '*AndroidPermissionContractTest' --tests '*AndroidServiceLifecycleTest' --tests '*PetOverlayServiceTest' --init-script /private/tmp/task6-isolated-build.gradle`

Result: expected RED at Kotlin test compilation. The permission contract,
persisted lifecycle state, and foreground notification builder were unresolved.
The follow-up quit-recovery test was also authored before production and failed
against the same absent lifecycle contract.

### Baseline Findings

The pre-edit Android/i18n baseline had two unrelated failures: fixed CJK overlay
menu copy failed `sourceCompleteness`, and the invalid disabled-reminder fixture
could not render its expected dialog. Both were corrected within the bounded
Task 7 localization/regression scope and are GREEN below.

## GREEN Evidence

1. Focused Task 7 TypeScript:
   `npm run test:run -- src/android/components/AndroidOnboarding.test.tsx src/android/components/AndroidApp.test.tsx src/android/bridge/androidHost.test.ts src/i18n/sourceCompleteness.test.ts`
   Result: 4 files passed, 19 tests passed.
2. Focused overlay/onboarding regression:
   `npm run test:run -- src/android/components/AndroidOverlayStage.test.tsx src/android/components/AndroidOnboarding.test.tsx`
   Result: 2 files passed, 12 tests passed.
3. Final Android/i18n/desktop capability regression:
   `npm run test:run -- src/android src/i18n src/app/CapabilityStatus.test.tsx`
   Result: 16 files passed, 74 tests passed.
4. TypeScript:
   `npm run typecheck`
   Result: exit 0.
5. Focused native/JUnit/Robolectric:
   `./gradlew testDebugUnitTest --tests '*AndroidPermissionContractTest' --tests '*AndroidServiceLifecycleTest' --tests '*ReminderRecoveryQuitTest' --tests '*PetOverlayServiceTest' --init-script /private/tmp/task6-isolated-build.gradle`
   Result: `BUILD SUCCESSFUL` in 31 seconds.
6. Complete native unit/Robolectric:
   `./gradlew testDebugUnitTest --init-script /private/tmp/task6-isolated-build.gradle`
   Result: `BUILD SUCCESSFUL` in 6 seconds.
7. Bounded Android debug build:
   `./gradlew assembleDebug --init-script /private/tmp/task6-isolated-build.gradle`
   Result: `BUILD SUCCESSFUL` in 22 seconds. Resource merge and APK packaging
   completed within the bound; no process required termination.

## Scope and Remaining Risks

- `release/`, `dist-android/`, generated Capacitor Gradle files, and the progress
  ledger were not modified or staged. Android web sync was intentionally not run
  because it would modify explicitly forbidden generated paths.
- No desktop bootstrap, Electron source, desktop CSS, package metadata, or
  release artifact behavior changed. The focused desktop capability regression
  and project typecheck pass; the full desktop release gate remains Task 10.
- JVM/Robolectric cannot prove real-device overlay settings return behavior,
  Android 13 notification dialogs, OEM battery scheduling, notification drawer
  presentation, or task removal. Task 9 instrumentation and Task 10 physical
  device acceptance remain responsible for those checks.
- The existing Gradle `flatDir` metadata warning remains unchanged.

## Review Findings Follow-up (2026-08-08)

Follow-up base: `8f9a0fde4636badaaeb66d7f0163ac4643932226`

### Corrections

- Hardened the persisted Quit latch so only the explicit Activity launch hook calls `noteUserLaunch`; service `START`, `SHOW`, and `OPEN_REMINDER` intents reject before lifecycle mutation while Quit remains latched.
- Made the overlay menu Hide path persist `lifecycle.hide()` before removing the view, preserving hidden state across sticky service/process recreation while reminders continue.
- Split Android 13+ notification state into `notRequested`, `deniedCanAsk`, `blocked`, `granted`, and pre-Android-13 `notRequired`; untouched permission is requested contextually before auto-start, askable denial offers retry, and blocked/repeated denial opens app notification settings. Notification denial remains optional for foreground-service startup.
- Added a real Activity resume lifecycle boundary that refreshes capabilities, reacts to overlay revocation, and never clears Quit; only explicit user launch clears it.
- Added native boundary coverage for real `PetOverlayService.onStartCommand`, overlay menu bridge handling, Activity lifecycle resume/user-launch behavior, and BootReceiver/recovery-job suppression after Quit and process recreation.
- Completed bilingual English/Chinese notification request, retry, blocked explanation, and notification-settings labels.

### Strict TDD evidence

RED:

- `npm run test:run -- src/android/components/AndroidOnboarding.test.tsx src/android/components/AndroidApp.test.tsx src/android/bridge/androidHost.test.ts` failed as intended: 3 files failed, 9 tests failed and 12 passed. Failures covered richer notification states, notification-settings routing, untouched-permission auto-start gating, and blocked-state UI.
- `./gradlew testDebugUnitTest --tests '*AndroidPermissionContractTest' --tests '*AndroidHostLifecycleTest' --tests '*AndroidServiceLifecycleTest' --tests '*PetOverlayServiceTest' --tests '*ReminderRecoveryQuitTest' --init-script /private/tmp/task6-isolated-build.gradle` failed as intended at native test compilation because the lifecycle boundary and new permission contract did not yet exist and the real service bridge path was inaccessible.

GREEN:

- Focused web tests: 3 files, 21 tests passed in 1.17s.
- Focused native tests: `BUILD SUCCESSFUL` in 7s.
- Full Vitest suite: 63 files, 759 tests passed in 9.80s.
- TypeScript typecheck: passed.
- Complete native unit/Robolectric suite: `BUILD SUCCESSFUL` in 10s.
- Bounded `assembleDebug`: `BUILD SUCCESSFUL` in 735ms; 95 tasks, 3 executed and 92 up-to-date. No timeout was required.

The review-fix commit SHA is reported in the final handoff because this report is included in that commit.
