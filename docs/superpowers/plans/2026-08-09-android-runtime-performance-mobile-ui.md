# Android Runtime Performance and Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android reminder state update immediately, remove full spritesheets from routine app synchronization, prevent pet-page memory spikes, and deliver the approved concise mobile UI.

**Architecture:** Native Android exposes a lightweight revisioned runtime snapshot and publishes committed-state signals from both the app bridge and overlay reminder engine. The app applies runtime updates without reloading the pet library. Pet catalog previews use bounded native thumbnails and exist only while the pet page is mounted.

**Tech Stack:** React 19, TypeScript, Vitest, Capacitor, Kotlin, Android WebView, JUnit, Android instrumentation tests, CSS.

## Global Constraints

- Android runtime payloads must not contain pet ZIP data, full spritesheet bytes, or spritesheet Base64.
- Full spritesheets remain in native app storage and continue to be read directly by the overlay renderer.
- Runtime event bursts are coalesced and stale responses cannot overwrite newer state.
- Pet preview decoding is serial and bounded; leaving the pet page releases previews and in-flight work.
- The approved companion layout is option A: next reminder, countdown, today total, relationship level, and at most one later reminder.
- The pet import help control is a fixed `24px` circle.
- Chinese and English Android copy is concise and equivalent.
- Do not change desktop persistence, desktop UI, reminder intervals, or scheduling policy.
- Do not use git commands unless the user explicitly requests them.

---

### Task 1: Revisioned Native Runtime Snapshot and State Signal

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidCommittedStateBus.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidRuntimeSnapshot.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidRuntimeSnapshotTest.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidCommittedStateBusTest.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateStore.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateCoordinator.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderEngine.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidStateCoordinatorTest.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/reminders/ReminderEngineTest.kt`

**Interfaces:**
- Produces: `AndroidRuntimeSnapshot(schemaVersion: Int, revision: Long, settingsJson: String?, historyJson: List<String>)`.
- Produces: `AndroidStateCoordinator.loadRuntimeSnapshot(): String?`.
- Produces: Capacitor method `loadRuntimeSnapshot()` and event `{ type: "runtimeStateChanged", revision: number }`.
- Produces: `AndroidCommittedStateBus.publish(revision: Long)` and `subscribe(listener): () -> Unit`.

- [ ] **Step 1: Write failing compact-payload and revision tests**

Create tests that seed two assets with large Base64 strings, commit a reminder action, and assert:

```kotlin
val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))
assertEquals(1, runtime.getInt("schemaVersion"))
assertTrue(runtime.getLong("revision") > previousRevision)
assertTrue(runtime.has("settingsJson"))
assertTrue(runtime.has("historyJson"))
assertFalse(runtime.has("pets"))
assertFalse(runtime.toString().contains("spritesheetBase64"))
```

Add a bus test proving multiple subscribers receive the committed revision and unsubscribe removes the listener.

- [ ] **Step 2: Run native tests and verify RED**

Run:

```bash
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME="$PWD/.gradle-user-home" ./android/gradlew -p android --no-daemon :app:testDebugUnitTest --tests 'io.elevenlabs.codexpetpause.bridge.AndroidRuntimeSnapshotTest' --tests 'io.elevenlabs.codexpetpause.bridge.AndroidCommittedStateBusTest' --tests 'io.elevenlabs.codexpetpause.reminders.ReminderEngineTest'
```

Expected: FAIL because the runtime snapshot and committed-state bus do not exist and reminder completion does not publish a revision.

- [ ] **Step 3: Implement monotonic revisions and compact runtime serialization**

Store `runtimeRevision` at the state root, accepting missing values as revision `0` for existing installations. Increment it inside the coordinator's single synchronized persistence boundary. Serialize only `settingsJson` and `historyJson` into `AndroidRuntimeSnapshot`; never copy `pets` or `overlay.activePet`.

- [ ] **Step 4: Publish native reminder commits**

After `ReminderEngine` successfully commits complete, snooze, or skip, publish the committed revision. Register `AndroidHostPlugin` with the bus and forward a lightweight `runtimeStateChanged` event. Remove the listener when the plugin is destroyed.

- [ ] **Step 5: Expose `loadRuntimeSnapshot` through Capacitor**

Resolve a compact `JSObject` from `coordinator.loadRuntimeSnapshot()`. Missing state resolves as native null and retains the existing clean-install handling.

- [ ] **Step 6: Run native tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests pass and no runtime JSON contains `spritesheetBase64`.

---

### Task 2: Ordered Android Runtime Refresh in React

**Files:**
- Create: `src/android/domain/runtimeSnapshot.ts`
- Create: `src/android/domain/runtimeSnapshot.test.ts`
- Create: `src/android/infrastructure/androidRuntimeRepository.ts`
- Create: `src/android/infrastructure/androidRuntimeRepository.test.ts`
- Modify: `src/android/bridge/androidHost.ts`
- Modify: `src/android/bridge/androidHost.test.ts`
- Modify: `src/app/appController.ts`
- Modify: `src/app/appController.externalState.test.ts`
- Modify: `src/main.android.tsx`
- Modify: `src/android/domain/androidRuntime.ts`
- Modify: `src/android/domain/androidRuntime.test.ts`

**Interfaces:**
- Consumes: native `loadRuntimeSnapshot()` and `runtimeStateChanged` event from Task 1.
- Produces: `AndroidRuntimeState { revision: number; settings: AppSettings; history: ActivityEvent[] }`.
- Produces: `AppController.applyCommittedRuntimeState(state: { revision: number; settings: AppSettings }): void`.
- Produces: `createOrderedAndroidRuntimeRefresh(load, apply): () => void`.

- [ ] **Step 1: Write failing parser and ordering tests**

Test strict schema validation, rejection of pet fields, and ordering:

```ts
const refresh = createOrderedAndroidRuntimeRefresh(load, (state) => applied.push(state.revision));
refresh();
refresh();
second.resolve(runtimeState(2));
first.resolve(runtimeState(1));
await flushPromises();
expect(applied).toEqual([2]);
```

Add a controller test proving runtime application updates scheduler settings while preserving existing `pets` object identities.

- [ ] **Step 2: Run TypeScript tests and verify RED**

```bash
npm test -- --run src/android/domain/runtimeSnapshot.test.ts src/android/infrastructure/androidRuntimeRepository.test.ts src/android/domain/androidRuntime.test.ts src/app/appController.externalState.test.ts
```

Expected: FAIL because compact runtime parsing and ordered refresh are absent.

- [ ] **Step 3: Implement strict runtime parsing and repository caching**

Parse settings and history once. Cache only the compact runtime promise. Invalidate on a newer native revision or a successful local runtime mutation. Never call `loadSnapshot()` from this repository.

- [ ] **Step 4: Add incremental controller application**

`applyCommittedRuntimeState` must update settings, rebuild scheduler state, preserve due-queue consistency, increment `historyRevision` when the native revision advances, and preserve the current pet catalog and Blob identities.

- [ ] **Step 5: Replace full hydration on native signals**

In `main.android.tsx`, subscribe to runtime signals and call the ordered compact refresh. Local settings writes invalidate runtime state without reloading pet data. A failed refresh leaves the current snapshot visible and schedules one coalesced retry.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests pass, late generation `1` cannot overwrite generation `2`, and pet objects remain referentially unchanged.

---

### Task 3: Lightweight Native Pet Catalog and Bounded Thumbnails

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/pets/AndroidPetCatalog.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/pets/PetThumbnailStore.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/pets/AndroidPetCatalogTest.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/pets/PetThumbnailStoreTest.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateCoordinator.kt`
- Modify: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidStateCoordinatorTest.kt`

**Interfaces:**
- Produces: native `loadPetCatalog(): { revision: number; activePetId: string; pets: AndroidPetCatalogEntry[] }`.
- Produces: `AndroidPetCatalogEntry { id, metadataJson, assetRevision, thumbnailBase64 }`.
- Produces: cached thumbnail files no larger than `128x128`, generated one at a time.

- [ ] **Step 1: Write failing payload and thumbnail-bound tests**

Seed standard `1536x2288` WebP fixtures and assert the catalog includes metadata and a decodable thumbnail, excludes `spritesheetBase64`, and keeps thumbnail dimensions at or below `128x128`. Assert two requests for the same immutable asset revision reuse the cached thumbnail.

- [ ] **Step 2: Run native tests and verify RED**

```bash
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME="$PWD/.gradle-user-home" ./android/gradlew -p android --no-daemon :app:testDebugUnitTest --tests 'io.elevenlabs.codexpetpause.pets.*'
```

Expected: FAIL because the catalog and thumbnail store do not exist.

- [ ] **Step 3: Implement serial thumbnail generation**

Decode one source atlas at a time, crop the first idle cell, scale within `128x128`, encode WebP or PNG, recycle intermediate bitmaps, and atomically cache by immutable asset revision. Reject missing, corrupt, oversized, or unsafe paths without activating the pet.

- [ ] **Step 4: Implement compact catalog serialization**

Read metadata and cached thumbnail bytes only. Do not place full spritesheet bytes in the response. Keep active selection as an ID rather than duplicating the active pet object.

- [ ] **Step 5: Expose `loadPetCatalog` and keep selection ID-only**

Add the Capacitor method and preserve the existing atomic native `selectPet(id)` transaction. Successful selection returns status and revision only.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: catalog and thumbnail tests pass with bounded image dimensions and no full atlas payload.

---

### Task 4: Mount-Scoped Android Pet Page

**Files:**
- Create: `src/android/domain/petCatalog.ts`
- Create: `src/android/domain/petCatalog.test.ts`
- Create: `src/android/infrastructure/androidPetCatalog.ts`
- Create: `src/android/infrastructure/androidPetCatalog.test.ts`
- Create: `src/android/components/AndroidPetLibrary.tsx`
- Create: `src/android/components/AndroidPetLibrary.test.tsx`
- Modify: `src/android/bridge/androidHost.ts`
- Modify: `src/android/bridge/androidHost.test.ts`
- Modify: `src/android/components/AndroidApp.tsx`
- Modify: `src/android/components/AndroidApp.test.tsx`
- Modify: `src/features/pets/components/PetLibrary.tsx`

**Interfaces:**
- Consumes: `loadPetCatalog()` from Task 3.
- Produces: `createAndroidPetCatalog(host)` with `load()`, `select(id)`, `delete(id)`, and `dispose()`.
- Produces: `AndroidPetLibrary` that wraps shared import dialogs but renders native thumbnail previews.

- [ ] **Step 1: Write failing lifecycle and payload tests**

Assert opening the pet view loads the catalog once, leaving it revokes every created object URL and aborts stale work, and switching only calls `selectPet(id)`. Assert no list operation calls the legacy full `loadSnapshot()`.

- [ ] **Step 2: Run TypeScript tests and verify RED**

```bash
npm test -- --run src/android/domain/petCatalog.test.ts src/android/infrastructure/androidPetCatalog.test.ts src/android/components/AndroidPetLibrary.test.tsx src/android/components/AndroidApp.test.tsx
```

Expected: FAIL because the mount-scoped catalog does not exist.

- [ ] **Step 3: Implement strict catalog parsing and preview URLs**

Validate safe IDs, metadata, revision, canonical thumbnail Base64, and bounded decoded size. Create object URLs only for thumbnails. Track and revoke all URLs in `dispose()`.

- [ ] **Step 4: Implement Android-specific pet rendering**

Reuse import, delete-confirmation, and error presentation behavior, but use `<img>` thumbnail previews instead of `PetSprite` and full atlas blobs. Disable only the selected operation, not the entire page. Restore the previous selected ID on failure.

- [ ] **Step 5: Mount the catalog only for `view === 'pet'`**

`AndroidApp` must not load catalog data on companion, reminders, or settings views. Switching away unmounts `AndroidPetLibrary` and releases resources.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass, URLs are revoked, stale loads cannot commit, and no full snapshot is requested.

---

### Task 5: Approved Concise Companion and Pet UI

**Files:**
- Create: `src/android/components/AndroidCompanionView.tsx`
- Create: `src/android/components/AndroidCompanionView.test.tsx`
- Modify: `src/android/components/AndroidApp.tsx`
- Modify: `src/android/components/AndroidApp.test.tsx`
- Modify: `src/styles/android.css`
- Modify: `src/i18n/messages.ts`
- Modify: `src/features/pets/components/PetLibrary.tsx`
- Modify: `src/features/pets/components/PetLibrary.test.tsx`

**Interfaces:**
- Consumes: incrementally updated app snapshot from Task 2.
- Produces: Android-only balanced companion layout and Android-scoped concise copy.

- [ ] **Step 1: Write failing mobile content and timer tests**

Render the Android companion with a reminder due at `now + 60_000`, advance fake timers, apply a committed runtime state with a new `nextDueAt`, and assert the displayed countdown becomes greater than zero and continues decrementing. Apply a new history revision and assert today's total increments without remounting.

Assert the normal companion view contains no four-category list or long notification paragraph and shows at most one later reminder.

- [ ] **Step 2: Write failing circular-help CSS test**

Extend the CSS contract test to assert an Android-scoped selector for `.pet-import-help-button` declares:

```css
width: 24px;
height: 24px;
min-width: 24px;
min-height: 24px;
max-width: 24px;
max-height: 24px;
aspect-ratio: 1;
border-radius: 50%;
```

- [ ] **Step 3: Run UI tests and verify RED**

```bash
npm test -- --run src/android/components/AndroidCompanionView.test.tsx src/android/components/AndroidApp.test.tsx src/features/pets/components/PetLibrary.test.tsx
```

Expected: FAIL because the concise view and scoped circular override are absent.

- [ ] **Step 4: Implement the approved companion layout**

Use one prominent next-reminder card, two compact summary blocks, and one optional later reminder row. Run the one-second display timer only while mounted. On visibility return, recalculate immediately from `Date.now()` and the latest committed deadline.

- [ ] **Step 5: Add concise Android localization**

Add separate Android keys for short status, next reminder, today total, relationship, one later reminder, and empty state. Preserve existing desktop message keys and wording.

- [ ] **Step 6: Compact the Android pet page and fix the help circle**

Reduce Android-only paragraph count, preview height, card gaps, and import copy. Scope the `24px` help-circle rule more specifically than the generic Android `.pet-library button { min-height: 48px; }` rule.

- [ ] **Step 7: Run UI tests and verify GREEN**

Run the command from Step 3. Expected: all selected tests pass in Chinese and English, and the help control remains circular at narrow widths.

---

### Task 6: Device Synchronization, Memory Stress, and Release APK

**Files:**
- Create: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/RuntimeSynchronizationTest.kt`
- Create: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/PetCatalogStressTest.kt`
- Modify: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/DeviceQa.kt` if the shared helper exists separately; otherwise modify the existing `DeviceQa` declaration in `OverlayGestureTest.kt`.
- Modify: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/PetImportPersistenceTest.kt`

**Interfaces:**
- Consumes: runtime event flow, lightweight pet catalog, and mobile UI from Tasks 1–5.
- Produces: tested APK in `release/`.

- [ ] **Step 1: Write failing end-to-end runtime synchronization test**

Keep the companion page open, trigger a native complete action, and assert within two seconds that the UI's countdown is greater than zero and today's completed total increases. Repeat for snooze and skip, asserting the latest revision wins.

- [ ] **Step 2: Write failing pet catalog stress test**

Import multiple standard `1536x2288` fixtures, enter and leave the pet page repeatedly, switch between default and imported pets, and assert:

```kotlin
assertFalse(DeviceQa.hasObservedAnr())
assertFalse(DeviceQa.hasObservedProcessDeath())
assertTrue(DeviceQa.currentPssBytes() < agreedTestMemoryCeiling)
```

Also assert catalog responses do not contain `spritesheetBase64` and routine runtime responses stay below a fixed small payload threshold.

- [ ] **Step 3: Run new device tests and verify RED where behavior is not yet connected**

```bash
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME="$PWD/.gradle-user-home" ./android/gradlew -p android --no-daemon :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.elevenlabs.codexpetpause.RuntimeSynchronizationTest,io.elevenlabs.codexpetpause.PetCatalogStressTest
```

Expected before all integration work is complete: failures identify any missing event, lifecycle cleanup, or memory boundary.

- [ ] **Step 4: Resolve only integration defects exposed by the device tests**

Keep fixes within the boundaries defined in Tasks 1–5. Do not add polling of full snapshots or increase memory limits to hide failures.

- [ ] **Step 5: Run the complete front-end verification**

```bash
npm test -- --run
npm run build
npm run android:sync
```

Expected: all test files pass, TypeScript compiles, and Android assets synchronize successfully.

- [ ] **Step 6: Run the complete Android verification from clean state**

```bash
JAVA_HOME=/tmp/codex-jdk21/Contents/Home ANDROID_HOME=/tmp/android-sdk GRADLE_USER_HOME="$PWD/.gradle-user-home" ./android/gradlew -p android --no-daemon :app:clean :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:connectedDebugAndroidTest
```

Expected: `BUILD SUCCESSFUL`, zero failed device tests, zero skipped required tests, and no ANR or process death in stress scenarios.

- [ ] **Step 7: Copy the exact verified APK and calculate its checksum**

```bash
mkdir -p release
cp android/app/build/outputs/apk/debug/app-debug.apk release/Codex-Pet-Pause-0.3.0-android-runtime-performance-ui-tested.apk
shasum -a 256 release/Codex-Pet-Pause-0.3.0-android-runtime-performance-ui-tested.apk
```

Deliver only this copied APK and report the complete verification counts and SHA-256.
