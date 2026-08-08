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
