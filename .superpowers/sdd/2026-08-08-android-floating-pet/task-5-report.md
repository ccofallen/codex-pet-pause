# Task 5 Report: Transparent Android Pet Overlay

## Status

GREEN. The transparent Android system overlay, local WebView renderer, Task4 touch dispatch, and Task2 placement persistence are implemented.

## Implementation

- Added `PetOverlayService` with `START`, `SHOW`, `HIDE`, `QUIT`, and `STATE_CHANGED` commands.
- Uses `TYPE_APPLICATION_OVERLAY`, `PixelFormat.TRANSLUCENT`, and `FLAG_NOT_FOCUSABLE`; every window update uses explicit pet, menu, or reminder dimensions and never `MATCH_PARENT`.
- Maps real `MotionEvent` input to Task4 `MotionEventSample` and delegates all gesture state to `OverlayGestureInterpreter`.
- Schedules single-tap `WAIT` at the shared Task4 250 ms boundary. The second-tap interval is half-open: elapsed time below 250 ms qualifies, while elapsed time at or above 250 ms settles the first tap.
- Persists normalized placement through the Task2 `AndroidStateCoordinator` and mirrors it into both overlay state and settings pet position.
- Added `OverlayWebViewFactory` with narrow `WebViewAssetLoader` handlers for packaged `assets/public/` resources and immutable internal pet spritesheets.
- Allows only `https://appassets.androidplatform.net/app/` and validated `/pet-assets/pets/<id>/<revision>/spritesheet.webp` paths, disables file/content and network loads, returns blocking responses for remote subresources, rejects remote navigation, and exposes one `postMessage` JavaScript method with a closed typed parser.
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

## Independent Review Fixes

- Corrected the overlay entry URL to `/app/index.html?overlay=1`, backed only by packaged `assets/public/`, and added a renderer test proving the mounted overlay emits `overlay-ready`.
- Replaced the whole-`filesDir` handler with an immutable spritesheet-only handler. `state.json`, metadata, malformed paths, file/content URLs, and remote HTTP(S) subresources are blocked.
- Added a shared `DOUBLE_TAP_WINDOW_MS = 250L` source of truth. The interpreter and service dispatcher both use the half-open `[0, 250 ms)` second-tap interval, so a callback and DOWN at exactly 250 ms produce the same single-tap result in either processing order.
- Removed the `WindowManager.LayoutParams` title assignment.

Review-fix RED evidence:

- Focused renderer failed because it still emitted `/local-files/` pet URLs.
- Focused native compilation failed because the public-entry interceptor and shared timing constant did not yet exist.

Review-fix GREEN evidence:

- `npm run test:run -- src/android/components/AndroidOverlayApp.test.tsx src/android/components/AndroidOverlayStage.test.tsx`
  - PASS: 2 files, 9 tests.
- Focused `PetOverlayServiceTest` and `OverlayGestureInterpreterTest`
  - PASS: Gradle `BUILD SUCCESSFUL` under `/private/tmp/codex-jdk21` and `/private/tmp/android-sdk`.
- `npm run typecheck`
  - PASS.
- `npm run android:build:web`
  - PASS.
- Full `npm run android:test:native`
  - PASS: Gradle `BUILD SUCCESSFUL`.

The remaining review-specific risk is real-device WebView behavior: resource isolation and response blocking are covered by Robolectric, but device instrumentation was not run.

## Timing Race Follow-up

The exact-boundary race now has an explicit half-open contract:

- A second DOWN with elapsed time `0 <= elapsed < DOUBLE_TAP_WINDOW_MS` may complete a double tap.
- A WAIT or second DOWN with `elapsed >= DOUBLE_TAP_WINDOW_MS` settles the first tap.
- `DOUBLE_TAP_WINDOW_MS` remains the only timing source; there is no 251 ms workaround.

Timing RED evidence:

- Focused native tests ran 29 tests and failed 3 new assertions under the former inclusive second-DOWN behavior.
- The failures covered direct interpreter boundary handling and service callback-first versus DOWN-first ordering.

Timing GREEN evidence:

- Focused `PetOverlayServiceTest` and `OverlayGestureInterpreterTest`: PASS, 29 tests, Gradle `BUILD SUCCESSFUL`.
- Full `npm run android:test:native`: PASS, Gradle `BUILD SUCCESSFUL`.
