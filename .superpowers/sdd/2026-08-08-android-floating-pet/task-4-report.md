# Android Task 4 Report

## Status

Implementation committed for pure Kotlin overlay geometry and gesture semantics.

## Scope

- Added safe-bounds geometry with 24dp edge snapping, full-edge attachment, 20dp minimum visible retraction, restore, and anchor-preserving resize.
- Added deterministic `MotionEventSample` gesture interpretation with pointer offset capture, touch slop, free/attached/retracted states, inward free-drag, outward retraction, exposed-pet restore, and 250ms single/double tap handling.
- Supported pet sizes: small 56dp, medium 72dp, and large 96dp.
- No Activity, WindowManager, WebView, real MotionEvent, timer, or asynchronous dependency.

## TDD and tests

Tests were written before the production classes. The initial focused Gradle attempt reached an environment RED because no Java Runtime was installed. After a temporary JDK 17 was placed under `/private/tmp`, both requested commands were attempted:

```text
./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
npm run android:test:native
```

Both stopped during Gradle configuration with:

```text
SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting sdk.dir in android/local.properties.
```

No Android SDK, `sdkmanager`, or `android.jar` was present on the machine, so Kotlin test compilation and execution could not be reached.

## Generated files

Existing generated `release/` and `dist-android/` content was not staged or committed.

## Concerns

- Focused and full native tests remain unverified until an Android SDK with compile/target SDK 36 is available.

## Follow-up verification

The provided environment was used exactly as requested:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH
```

RED evidence:

1. The original no-environment Gradle attempt was blocked before compilation because no Java Runtime was available.
2. With the provided environment, focused tests first reached Kotlin compilation and failed because `PointF.copy` received `Int` coordinates in `retract`.
3. After the compile fix, focused tests reached behavior and reported 12 tests with 2 failures: a sample movement was below the configured 8dp touch slop, and the single-tap wait sample was only 235ms after `ACTION_UP`.
4. After correcting those samples, one pointer-offset assertion still expected 210dp while the actual offset-preserving value was 209dp.

GREEN evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

Result: `BUILD SUCCESSFUL`; all 12 focused geometry/gesture tests passed.

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH npm run android:test:native
```

Result: `BUILD SUCCESSFUL`; complete `testDebugUnitTest` passed.

The follow-up fixes are committed in the final SHA reported with this task.

## Repair round 1

The earlier SDK concern is resolved using the supplied JDK 21 and Android SDK paths. This round added tests before production changes for all requested repairs: drag-end-only snapping, 9dp inward detach, outward-then-inward final direction, active-pointer CANCEL, second-pointer filtering, expired pending tap plus new DOWN, invalid/degenerate safe bounds, portrait/landscape Insets, and small/medium/large pet sizes.

RED evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

The first repair run failed during test compilation because `POINTER_DOWN` and `POINTER_UP` were not yet present in `MotionAction`.

After the minimal production implementation compiled, the focused suite reported 20 tests with one failure: the MOVE assertion expected an unclamped x coordinate, while the required clamp behavior produced x=328 with `Attachment.Free`. Correcting that test expectation produced GREEN.

GREEN evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

Result: `BUILD SUCCESSFUL`; all 20 focused geometry/gesture tests passed.

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH npm run android:test:native
```

Result: `BUILD SUCCESSFUL`; complete native unit tests passed.

Implementation and test commit SHA: `7cb16fb`.

## Repair round 2

This round covers the two requested boundary semantics.

RED evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

The first run compiled and reported 22 tests with 2 failures: the 250ms DOWN boundary was treated as expired, and CANCEL with default pointerId 0 did not clear an active pointerId 7 gesture. After the first minimal fix, CANCEL passed; the remaining failure showed that second-tap qualification was incorrectly rechecked at UP against the first UP timestamp.

GREEN evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

Result: `BUILD SUCCESSFUL`; all 22 focused tests passed. The 249ms and 250ms second-tap DOWN samples remain pending and open the menu; 251ms settles the previous tap as single.

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH npm run android:test:native
```

Result: `BUILD SUCCESSFUL`; complete native unit tests passed.

Implementation and test commit SHA: `f12a59c`.

## Repair round 3

This final timing round defines qualifying-second-gesture WAIT behavior and CANCEL consistency. A first tap whose UP is at 0ms remains pending while a qualifying second DOWN occurs at 249ms or 250ms. WAIT at 251ms and 300ms is `NoOp`; the later second UP emits `OpenMenu`. If that second gesture is CANCELed, the active second gesture is cleared and the first pending tap remains; the next WAIT after the strict deadline emits one `SingleTap`.

RED evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

The first run compiled and reported 24 tests with one failure: `onWait` settled the first pending tap while a qualifying second gesture was active.

GREEN evidence:

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'
```

Result: `BUILD SUCCESSFUL`; all 24 focused tests passed.

```text
JAVA_HOME=/private/tmp/codex-jdk21 ANDROID_HOME=/private/tmp/android-sdk ANDROID_SDK_ROOT=/private/tmp/android-sdk PATH=/private/tmp/codex-jdk21/bin:$PATH npm run android:test:native
```

Result: `BUILD SUCCESSFUL`; complete native unit tests passed.

Implementation and test commit SHA: `13de153`.
