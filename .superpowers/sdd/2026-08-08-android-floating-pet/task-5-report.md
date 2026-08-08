# Task 5 Report: Transparent Android Pet Overlay

## Status

GREEN. The transparent Android system overlay, local WebView renderer, Task4 touch dispatch, and Task2 placement persistence are implemented.

## Implementation

- Added `PetOverlayService` with `START`, `SHOW`, `HIDE`, `QUIT`, and `STATE_CHANGED` commands.
- Uses `TYPE_APPLICATION_OVERLAY`, `PixelFormat.TRANSLUCENT`, and `FLAG_NOT_FOCUSABLE`; every window update uses explicit pet, menu, or reminder dimensions and never `MATCH_PARENT`.
- Maps real `MotionEvent` input to Task4 `MotionEventSample` and delegates all gesture state to `OverlayGestureInterpreter`.
- Schedules single-tap `WAIT` at 251 ms after pointer up. A qualifying second gesture retains Task4's pending tap behavior.
- Persists normalized placement through the Task2 `AndroidStateCoordinator` and mirrors it into both overlay state and settings pet position.
- Added `OverlayWebViewFactory` with `WebViewAssetLoader` paths for bundled assets and immutable internal pet assets.
- Allows only `https://appassets.androidplatform.net/assets/` and `/local-files/`, disables file/content access and mixed content, rejects remote navigation, and exposes one `postMessage` JavaScript method with a closed typed parser.
- Added an Android-only React overlay entry that reuses `CatSprite`, `PetSprite`, and reminder presentation composition without mounting either desktop stage or depending on `window.petShell`.
- Added exact `small=56`, `medium=72`, and `large=96` sizing plus the Settings, Hide, Quit menu ordered toward available horizontal screen space.
- Added only the required overlay and special-use foreground-service manifest declarations. Permission guidance remains Task 7.

## TDD Evidence

RED was observed before production implementation:

- `npm run test:run -- src/android/components/AndroidOverlayStage.test.tsx`
  - Failed because `AndroidOverlayStage` did not exist.
- `JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk ./gradlew testDebugUnitTest --tests '*PetOverlayServiceTest'`
  - Failed because `PetOverlayService`, `OverlayWebViewFactory`, the dispatcher, and Robolectric test support did not exist.

## Final Verification

- `npm run test:run -- src/android src/features/cat/components/InteractiveCatStage.test.tsx src/features/pets/components/CodexPetStage.test.tsx`
  - PASS: 10 files, 106 tests.
- `npm run typecheck`
  - PASS.
- `npm run android:build:web`
  - PASS: Android production web bundle generated successfully.
- `JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk npm run android:test:native`
  - PASS: Gradle `BUILD SUCCESSFUL`, including native unit and Robolectric tests.

## Concerns

- Device instrumentation was not run; the brief explicitly excludes unrun instrumentation from Task 5 failure criteria.
- Overlay permission education and settings navigation remain intentionally deferred to Task 7.
- Android web, release, and Capacitor-generated Gradle outputs were not staged for this task.
