# Android Floating Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a signed Android APK that provides a phone-sized, system-wide floating pet, reliable background reminders, local pet imports, and the accepted Codex Pet Pause behavior without changing existing desktop editions.

**Architecture:** Capacitor 8.5.0 hosts a dedicated Android React entry point. Kotlin plugins and a foreground `WindowManager` service own permissions, local state mirroring, overlay lifecycle, reminder delivery, Petdex downloads, and boot recovery; Android-only React components reuse domain and sprite primitives without routing Android behavior through Electron APIs.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Capacitor 8.5.0, Kotlin, Android SDK 28+, AndroidX, Vitest, JUnit, Robolectric, Espresso, GitHub Actions

## Global Constraints

- Minimum supported system is Android 9 / API 28.
- Initial release artifact is a signed universal pure-JVM/WebView APK with no native `.so` libraries, compatible with arm64 devices distributed through GitHub Releases.
- Medium is the default phone pet size: small `56dp`, medium `72dp`, large `96dp`.
- Android storage, permissions, lifecycle, CSS, and entry points must remain isolated from Electron and web hosts.
- Existing macOS, Windows, Linux, web behavior, persistence, packaging, and release artifacts must remain unchanged.
- Settings, history, reminder state, and imported pet files remain local to application-private storage.
- A foreground-service notification is visible whenever the overlay/reminder service is running.
- Existing ZIP security limits and completion queue behavior remain authoritative.
- Every shared TypeScript change must pass its focused tests and the final `npm run check:desktop-release` gate.

---

## File Structure

### Shared TypeScript additions

- `src/android/bridge/androidHost.ts`: typed Capacitor/native bridge facade.
- `src/android/bridge/androidHost.test.ts`: bridge parsing and unavailable-host tests.
- `src/android/infrastructure/androidRepositories.ts`: settings, history, and pet repository adapters backed by the native bridge.
- `src/android/infrastructure/androidRepositories.test.ts`: persistence adapter contract tests.
- `src/android/components/AndroidApp.tsx`: phone application shell.
- `src/android/components/AndroidOnboarding.tsx`: notification and overlay permission flow.
- `src/android/components/AndroidCapabilityStatus.tsx`: Android-specific service and permission state.
- `src/android/components/AndroidOverlayApp.tsx`: transparent overlay renderer.
- `src/android/components/AndroidOverlayStage.tsx`: built-in/imported pet selection and reminder bubble composition.
- `src/android/components/*.test.tsx`: mobile shell, permission, overlay, and queue tests.
- `src/android/domain/overlayProtocol.ts`: serializable messages exchanged with the foreground service.
- `src/android/domain/overlayProtocol.test.ts`: strict protocol repair/validation tests.
- `src/main.android.tsx`: Android dependency wiring only.
- `src/styles/android.css`: Activity-only responsive styles.
- `src/styles/android-overlay.css`: transparent overlay-only styles.
- `src/types/android-api.d.ts`: global Android bridge types.

### Existing TypeScript files with bounded changes

- `src/main.tsx`: select the Android bootstrap only for `VITE_APP_HOST=android`; preserve the existing bootstrap byte-for-byte in a web/desktop module.
- `src/main.web.tsx`: receives the current `src/main.tsx` implementation unchanged.
- `vite.config.ts`: add Android base/output behavior without changing desktop/pages branches.
- `src/i18n/types.ts`, `src/i18n/messages.ts`: add complete Chinese and English Android copy.
- `package.json`, `package-lock.json`: lock Capacitor 8.5.0 and Android scripts.

### Native Android files

- `capacitor.config.ts`: stable app identity and `dist-android` web directory.
- `android/app/src/main/AndroidManifest.xml`: overlay, notification, foreground service, internet, and boot declarations.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/MainActivity.kt`: plugin registration and Activity lifecycle.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`: Capacitor calls and events.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateStore.kt`: atomic app-private JSON and pet asset persistence.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayGeometry.kt`: safe bounds, snapping, and retraction calculations.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayGestureInterpreter.kt`: tap, double tap, drag, and outward swipe state machine.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`: foreground service and `WindowManager` ownership.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`: isolated transparent local renderer.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderEngine.kt`: persisted due-time scheduling and queue transitions.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactory.kt`: channels, sound, and actions.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/BootReceiver.kt`: permitted post-reboot restoration.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt`: sandboxed Petdex browser and download interception.
- `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PendingPetArchiveStore.kt`: bounded temporary ZIP handoff.
- `android/app/src/test/...`: JVM/Robolectric tests for each pure/native unit.
- `android/app/src/androidTest/...`: gesture, permission, Activity/overlay, and import instrumentation tests.

### Build and release files

- `.github/workflows/build-android.yml`: validation, signed universal APK build, digest, and artifact upload to the coordinated publisher.
- `.github/workflows/build-desktop.yml`: produce and validate the unchanged desktop asset matrix for the coordinated publisher.
- `scripts/verify-android-release.mjs`: inspect artifact name, native-library absence, version, and digest.
- `scripts/verify-android-release.test.mjs`: release verifier fixtures.
- `scripts/verify-desktop-workflow.test.mjs`: prove the desktop producer preserves its complete platform matrix without publishing directly.
- `docs/ANDROID-INSTALL.md`, `docs/ANDROID-INSTALL.zh-CN.md`: permissions, installation, persistence, and recovery guidance.
- `README.md`, `README.zh-CN.md`: Android download link and concise platform description.

---

### Task 1: Add an Android Build Boundary

**Files:**
- Create: `capacitor.config.ts`
- Create: `src/main.web.tsx`
- Create: `src/main.android.tsx`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `src/app/androidBootstrap.test.ts`

**Interfaces:**
- Consumes: existing `createAppController(...)` ports and current web/Electron bootstrap.
- Produces: `VITE_APP_HOST=android`, `npm run android:build:web`, and a Capacitor `webDir` of `dist-android`.

- [ ] **Step 1: Write the failing host-selection test**

```ts
import { describe, expect, test } from 'vitest';
import { selectBootstrap } from './bootstrapHost';

describe('selectBootstrap', () => {
  test('selects Android only for the explicit Android build host', () => {
    expect(selectBootstrap('android')).toBe('android');
    expect(selectBootstrap('desktop')).toBe('web');
    expect(selectBootstrap(undefined)).toBe('web');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:run -- src/app/androidBootstrap.test.ts`

Expected: FAIL because `bootstrapHost.ts` and `selectBootstrap` do not exist.

- [ ] **Step 3: Add the isolated bootstrap and Capacitor configuration**

```ts
// src/app/bootstrapHost.ts
export type BootstrapHost = 'web' | 'android';
export const selectBootstrap = (value: string | undefined): BootstrapHost =>
  value === 'android' ? 'android' : 'web';
```

```ts
// src/main.tsx
import { selectBootstrap } from './app/bootstrapHost';

const host = selectBootstrap(import.meta.env.VITE_APP_HOST);
void (host === 'android' ? import('./main.android') : import('./main.web'));
```

Move the current contents of `src/main.tsx` unchanged into `src/main.web.tsx`.
Configure `vite.config.ts` so only Android mode writes `dist-android` with base
`./`; leave the current desktop base and Pages base logic unchanged.

```ts
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.elevenlabs.codexpetpause',
  appName: 'Codex Pet Pause',
  webDir: 'dist-android',
  android: { backgroundColor: '#f5f4ef' },
};
export default config;
```

Add exact dependencies `@capacitor/core@8.5.0`, `@capacitor/android@8.5.0`, and
`@capacitor/cli@8.5.0`. Add scripts:

```json
{
  "android:build:web": "VITE_APP_HOST=android vite build --mode android --outDir dist-android",
  "android:sync": "npm run android:build:web && cap sync android",
  "android:apk:debug": "npm run android:sync && cd android && ./gradlew assembleDebug",
  "android:test:native": "cd android && ./gradlew testDebugUnitTest",
  "android:test:instrumented": "cd android && ./gradlew connectedDebugAndroidTest"
}
```

Run `npx cap add android` once to generate the Android project, then set
`minSdkVersion = 28` in the generated Android variables file.

- [ ] **Step 4: Verify Android and desktop build selection GREEN**

Run: `npm run test:run -- src/app/androidBootstrap.test.ts && npm run build && npm run desktop:build && npm run android:build:web`

Expected: PASS; `dist-android` is generated and existing web/desktop builds remain successful.

- [ ] **Step 5: Commit the build boundary**

```bash
git add capacitor.config.ts android package.json package-lock.json vite.config.ts src/main.tsx src/main.web.tsx src/main.android.tsx src/app/bootstrapHost.ts src/app/androidBootstrap.test.ts
git commit -m "feat: add isolated Android build host"
```

### Task 2: Define the Android Bridge and Versioned Local Store

**Files:**
- Create: `src/types/android-api.d.ts`
- Create: `src/android/domain/overlayProtocol.ts`
- Create: `src/android/domain/overlayProtocol.test.ts`
- Create: `src/android/bridge/androidHost.ts`
- Create: `src/android/bridge/androidHost.test.ts`
- Create: `src/android/infrastructure/androidRepositories.ts`
- Create: `src/android/infrastructure/androidRepositories.test.ts`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidStateStore.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/MainActivity.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/bridge/AndroidStateStoreTest.kt`

**Interfaces:**
- Produces: `AndroidHost.loadSnapshot(): Promise<AndroidHostSnapshot>`, `saveSettings(json)`, `appendHistory(json)`, `savePet(input)`, `deletePet(id)`, `selectPet(id)`, `subscribe(listener)`.
- Produces: native `state.json` schema version `1` and `filesDir/pets/<safe-id>/pet.json|spritesheet.webp`.

- [ ] **Step 1: Write failing protocol and atomic-store tests**

```ts
test('rejects a native snapshot with an unsupported schema', () => {
  expect(() => parseAndroidHostSnapshot({ schemaVersion: 2 })).toThrow('unsupported Android state schema');
});

test('repairs coordinates without accepting executable pet paths', () => {
  const value = parseAndroidHostSnapshot(snapshotFixture({ assetPath: '../escape.webp' }));
  expect(value.activePet).toBeUndefined();
});
```

```kotlin
@Test fun failedReplacementKeepsPreviousState() {
  store.writeSnapshot(validSnapshot)
  fileSystem.failNextAtomicMove()
  assertFails { store.writeSnapshot(replacement) }
  assertEquals(validSnapshot, store.readSnapshot())
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:run -- src/android/domain/overlayProtocol.test.ts src/android/bridge/androidHost.test.ts src/android/infrastructure/androidRepositories.test.ts`

Run: `cd android && ./gradlew testDebugUnitTest --tests '*AndroidStateStoreTest'`

Expected: FAIL because the bridge, parser, repositories, and native store are absent.

- [ ] **Step 3: Implement strict contracts and atomic persistence**

```ts
export interface AndroidHostSnapshot {
  schemaVersion: 1;
  settingsJson: string;
  historyJson: readonly string[];
  pets: readonly AndroidPetAsset[];
  overlay: AndroidOverlayState;
}

export interface AndroidHost {
  loadSnapshot(): Promise<AndroidHostSnapshot>;
  saveSettings(settingsJson: string): Promise<void>;
  appendHistory(eventJson: string): Promise<void>;
  savePet(input: AndroidPetWrite): Promise<void>;
  deletePet(id: string): Promise<void>;
  selectPet(id: string): Promise<void>;
  subscribe(listener: (event: AndroidHostEvent) => void): () => void;
}
```

Use `AtomicFile` for `state.json`, reject path separators in pet IDs, write pet
assets to a temporary sibling directory, and rename only after both files and
metadata validate. Register `AndroidHostPlugin` explicitly from `MainActivity`.

- [ ] **Step 4: Run bridge, repository, and native tests GREEN**

Run: `npm run test:run -- src/android && npm run typecheck && npm run android:test:native`

Expected: PASS with round-trip settings/history/pet fixtures and rollback coverage.

- [ ] **Step 5: Commit the local data bridge**

```bash
git add src/android src/types/android-api.d.ts android/app/src/main/java/io/elevenlabs/codexpetpause/bridge android/app/src/main/java/io/elevenlabs/codexpetpause/MainActivity.kt android/app/src/test
git commit -m "feat: add Android local state bridge"
```

### Task 3: Build the Phone Settings Shell

**Files:**
- Create: `src/android/components/AndroidApp.tsx`
- Create: `src/android/components/AndroidApp.test.tsx`
- Create: `src/android/components/AndroidCapabilityStatus.tsx`
- Create: `src/styles/android.css`
- Modify: `src/main.android.tsx`
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/messages.ts`
- Test: `src/i18n/messages.test.ts`
- Test: `src/i18n/sourceCompleteness.test.ts`

**Interfaces:**
- Consumes: Android repositories from Task 2 and existing `Dashboard`, `SettingsPage`, `PetLibrary`, and `InsightsPanel`.
- Produces: `AndroidApp` with `companion | reminders | pet | settings` views and Android-only capability messaging.

- [ ] **Step 1: Write failing mobile layout and localization tests**

```tsx
test('keeps the save and Petdex actions in the mobile thumb action region', () => {
  renderAndroidApp();
  const actions = screen.getByTestId('android-thumb-actions');
  expect(within(actions).getByRole('button', { name: '保存设置' })).toBeVisible();
  expect(within(actions).getByRole('button', { name: '浏览 Petdex 并自动导入' })).toBeVisible();
});

test('does not render an embedded second pet in Android settings', () => {
  renderAndroidApp();
  expect(screen.queryByTestId('interactive-cat-stage')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI and i18n tests and verify RED**

Run: `npm run test:run -- src/android/components/AndroidApp.test.tsx src/i18n/messages.test.ts src/i18n/sourceCompleteness.test.ts`

Expected: FAIL because the Android shell and Android copy do not exist.

- [ ] **Step 3: Implement Android-only layout and complete bilingual copy**

```tsx
export function AndroidApp() {
  return (
    <div data-app-host="android" className="android-app-shell">
      <main className="android-scroll-content">{/* accepted shared panels */}</main>
      <div data-testid="android-thumb-actions" className="android-thumb-actions">
        {/* active view primary and secondary actions */}
      </div>
      <nav className="android-bottom-navigation">{/* four views */}</nav>
    </div>
  );
}
```

Scope every rule below `[data-app-host='android']`. Use safe-area insets,
`min-height: 48px` buttons, a single-column settings grid below `720px`, and
bottom padding equal to navigation plus the thumb action region. Do not import
`android.css` from web or desktop bootstraps.

- [ ] **Step 4: Run Android UI plus existing AppShell tests GREEN**

Run: `npm run test:run -- src/android/components/AndroidApp.test.tsx src/app/AppShell.test.tsx src/i18n && npm run typecheck`

Expected: PASS in Chinese and English; desktop `AppShell` assertions remain unchanged.

- [ ] **Step 5: Commit the phone shell**

```bash
git add src/android/components src/styles/android.css src/main.android.tsx src/i18n
git commit -m "feat: add phone-optimized Android settings shell"
```

### Task 4: Implement Overlay Geometry and Gesture Semantics

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayGeometry.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayGestureInterpreter.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/OverlayGeometryTest.kt`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/OverlayGestureInterpreterTest.kt`

**Interfaces:**
- Produces: `OverlayGeometry.clamp`, `snapIfInsideZone`, `retract`, `restore`, and `resizeAroundAnchor`.
- Produces: `OverlayGestureInterpreter.consume(MotionEventSample): OverlayGestureResult`.

- [ ] **Step 1: Write failing geometry and gesture tests**

```kotlin
@Test fun petAwayFromEdgeNeverMovesAutomatically() {
  assertEquals(PointF(320f, 500f), geometry.snapIfInsideZone(PointF(320f, 500f), bounds))
}

@Test fun attachedPetRetractsOnlyAfterSecondOutwardSwipe() {
  interpreter.consume(dragToRightEdge)
  assertEquals(Attached(RIGHT, retracted = false), interpreter.state)
  interpreter.consume(waitForTenSeconds)
  assertEquals(Attached(RIGHT, retracted = false), interpreter.state)
  interpreter.consume(outwardSwipe)
  assertEquals(Attached(RIGHT, retracted = true), interpreter.state)
}

@Test fun doubleTapWinsOverSingleTap() {
  assertEquals(OpenMenu, interpreter.consume(twoTapsWithin(250)))
}
```

- [ ] **Step 2: Run native tests and verify RED**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*OverlayGeometryTest' --tests '*OverlayGestureInterpreterTest'`

Expected: FAIL because geometry and gesture classes do not exist.

- [ ] **Step 3: Implement pure geometry and deterministic gesture state**

```kotlin
sealed interface Attachment {
  data object Free : Attachment
  data class Edge(val side: Side, val retracted: Boolean) : Attachment
}

data class OverlayPlacement(
  val x: Int,
  val y: Int,
  val sizeDp: Int,
  val attachment: Attachment,
)
```

Use safe `WindowInsets`, a `24dp` edge snap zone, `ViewConfiguration` touch
slop, a 250 ms double-tap window, and the pointer-to-pet offset captured on
`ACTION_DOWN`. Retraction leaves at least `20dp` visible and tappable. Waiting
does not change attachment state.

- [ ] **Step 4: Run the geometry matrix GREEN**

Run: `npm run android:test:native`

Expected: PASS for left/right edges, cutouts, three-button navigation, gesture navigation, portrait, landscape, and all three pet sizes.

- [ ] **Step 5: Commit geometry and gestures**

```bash
git add android/app/src/main/java/io/elevenlabs/codexpetpause/overlay android/app/src/test/java/io/elevenlabs/codexpetpause/overlay
git commit -m "feat: define Android pet overlay gestures"
```

### Task 5: Render the Pet in a Transparent System Overlay

**Files:**
- Create: `src/android/components/AndroidOverlayApp.tsx`
- Create: `src/android/components/AndroidOverlayStage.tsx`
- Create: `src/android/components/AndroidOverlayStage.test.tsx`
- Create: `src/styles/android-overlay.css`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/OverlayWebViewFactory.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/overlay/PetOverlayService.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `android/app/src/test/java/io/elevenlabs/codexpetpause/overlay/PetOverlayServiceTest.kt`

**Interfaces:**
- Consumes: geometry/gesture types from Task 4 and state/assets from Task 2.
- Produces: service commands `START`, `SHOW`, `HIDE`, `QUIT`, `STATE_CHANGED` and overlay messages `pet-tap`, `open-menu`, `placement-changed`, `bubble-size-changed`.

- [ ] **Step 1: Write failing renderer and service tests**

```tsx
test.each([['small', 56], ['medium', 72], ['large', 96]] as const)(
  'renders %s at %idp', (size, dp) => {
    renderOverlay({ size });
    expect(screen.getByTestId('android-pet')).toHaveStyle(`--android-pet-size: ${dp}px`);
  },
);

test('opens a three-action menu toward available screen space', () => {
  renderOverlay({ menuOpen: true, side: 'right' });
  expect(screen.getByRole('menu')).toHaveAttribute('data-expand', 'left');
});
```

```kotlin
@Test fun windowUsesTransparentWrapContentLayout() {
  val params = service.createPetLayoutParams()
  assertEquals(PixelFormat.TRANSLUCENT, params.format)
  assertNotEquals(MATCH_PARENT, params.width)
  assertNotEquals(MATCH_PARENT, params.height)
}
```

- [ ] **Step 2: Run overlay tests and verify RED**

Run: `npm run test:run -- src/android/components/AndroidOverlayStage.test.tsx`

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PetOverlayServiceTest'`

Expected: FAIL because renderer and service are absent.

- [ ] **Step 3: Implement a minimal-bounds overlay and renderer bridge**

Create `TYPE_APPLICATION_OVERLAY` parameters with translucent format,
`FLAG_NOT_FOCUSABLE`, no title bar, and dimensions derived from the active pet,
menu, or bubble. Use a local `WebViewAssetLoader` origin for the Android bundle,
disable file/content access not required by bundled assets, disable remote
navigation, and expose only the typed overlay message bridge.

```tsx
export function AndroidOverlayStage({ snapshot, host }: Props) {
  const pet = snapshot.pets.find(({ id }) => id === snapshot.settings.activePetId);
  return pet === undefined
    ? <AndroidPetSurface size={snapshot.settings.petSize}><CatSprite /></AndroidPetSurface>
    : <AndroidPetSurface size={snapshot.settings.petSize}><PetSprite pet={pet} /></AndroidPetSurface>;
}
```

The menu order is Settings, Hide Pet, Quit. A pet away from an edge remains at
its saved coordinates. Register service cleanup so Quit removes every overlay
view and stops foreground execution.

- [ ] **Step 4: Run renderer/service and desktop-stage regression tests GREEN**

Run: `npm run test:run -- src/android/components/AndroidOverlayStage.test.tsx src/features/cat/components/InteractiveCatStage.test.tsx src/features/pets/components/CodexPetStage.test.tsx && npm run android:test:native`

Expected: PASS; Android tests do not require `window.petShell`, and desktop tests remain unchanged.

- [ ] **Step 5: Commit the overlay renderer**

```bash
git add src/android/components/AndroidOverlayApp.tsx src/android/components/AndroidOverlayStage.tsx src/android/components/AndroidOverlayStage.test.tsx src/styles/android-overlay.css android/app/src/main
git commit -m "feat: render pets in an Android system overlay"
```

### Task 6: Add Native Reminder Delivery and Queue Recovery

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderEngine.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/ReminderNotificationFactory.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/reminders/BootReceiver.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/reminders/ReminderEngineTest.kt`
- Create: `src/android/components/AndroidReminderBubble.test.tsx`
- Modify: `src/android/components/AndroidOverlayStage.tsx`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: versioned reminder JSON from Task 2 and overlay `STATE_CHANGED` from Task 5.
- Produces: `ReminderEngine.reconcile(now)`, `snooze(id, until)`, `complete(id)`, `pendingQueue()`, and native notification actions.

- [ ] **Step 1: Write failing timing, recovery, sound, and queue tests**

```kotlin
@Test fun processRecoveryPreservesPersistedCountdown() {
  store.write(nextDueAt = 10_000L)
  val restored = ReminderEngine(store, clockAt(8_000L))
  assertEquals(2_000L, restored.delayUntilNext())
}

@Test fun completingCurrentReminderAdvancesOrCloses() {
  engine.seedDue(listOf("water", "stand"))
  assertEquals(ShowReminder("stand"), engine.complete("water"))
  assertEquals(CloseBubble, engine.complete("stand"))
}

@Test fun importedPetUsesSystemSound() {
  assertEquals(Sound.SYSTEM, notificationFactory.soundFor(importedPet()))
  assertEquals(Sound.CAT, notificationFactory.soundFor(builtInCat()))
}
```

- [ ] **Step 2: Run reminder tests and verify RED**

Run: `cd android && ./gradlew testDebugUnitTest --tests '*ReminderEngineTest'`

Run: `npm run test:run -- src/android/components/AndroidReminderBubble.test.tsx`

Expected: FAIL because the native engine and Android bubble integration are absent.

- [ ] **Step 3: Implement persisted one-shot scheduling and notification channels**

Use a coroutine timer while the foreground service is alive and a persisted
one-shot `AlarmManager.setAndAllowWhileIdle` alarm as process-recovery backup.
Do not request Android's special exact-alarm permission. Every timer and backup
alarm is re-derived after completion, snooze, settings save, timezone change,
boot, or service restoration. Quiet hours advance delivery to the next allowed
instant.

Create separate cat-sound and system-sound notification channels because Android
channel sound is immutable after creation. Notification actions open the bubble,
snooze, show the pet, open settings, or quit. Register `BootReceiver` only for
enabled reminders and restore the foreground service within current Android
background-start rules.

- [ ] **Step 4: Run native reminder and accepted queue tests GREEN**

Run: `npm run test:run -- src/android/components/AndroidReminderBubble.test.tsx src/features/cat/components/CatReminderBubble.test.tsx src/features/reminders/components/ActionCard.test.tsx && npm run android:test:native`

Expected: PASS; the final completion closes and a queued successor appears directly.

- [ ] **Step 5: Commit reminder delivery**

```bash
git add android/app/src/main/java/io/elevenlabs/codexpetpause/reminders android/app/src/test/java/io/elevenlabs/codexpetpause/reminders android/app/src/main/AndroidManifest.xml src/android/components
git commit -m "feat: deliver Android reminders in the background"
```

### Task 7: Add Android Permissions and Service Onboarding

**Files:**
- Create: `src/android/components/AndroidOnboarding.tsx`
- Create: `src/android/components/AndroidOnboarding.test.tsx`
- Modify: `src/android/components/AndroidCapabilityStatus.tsx`
- Modify: `src/android/bridge/androidHost.ts`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/messages.ts`
- Test: `src/i18n/sourceCompleteness.test.ts`

**Interfaces:**
- Produces: `getCapabilities()`, `requestNotifications()`, `openOverlaySettings()`, `startService()`, `showPet()`, `hidePet()`, and `quit()`.

- [ ] **Step 1: Write failing permission-flow tests**

```tsx
test('explains overlay permission before opening system settings', async () => {
  const host = deniedAndroidHost();
  render(<AndroidOnboarding host={host} />);
  await user.click(screen.getByRole('button', { name: '启用悬浮宠物' }));
  expect(screen.getByText('允许宠物显示在其他应用上层')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '前往授权' }));
  expect(host.openOverlaySettings).toHaveBeenCalledOnce();
});

test('keeps settings usable when permission is refused', () => {
  render(<AndroidApp host={deniedAndroidHost()} />);
  expect(screen.getByRole('navigation')).toBeVisible();
  expect(screen.getByRole('button', { name: '重新授权' })).toBeVisible();
});
```

- [ ] **Step 2: Run permission and bilingual-copy tests and verify RED**

Run: `npm run test:run -- src/android/components/AndroidOnboarding.test.tsx src/i18n`

Expected: FAIL because onboarding capabilities and copy are absent.

- [ ] **Step 3: Implement contextual permission requests and recovery**

Request `POST_NOTIFICATIONS` on Android 13+, then open
`Settings.ACTION_MANAGE_OVERLAY_PERMISSION` for this package. Recheck permission
in `onResume`; never infer success from returning to the Activity. Start the
foreground service only after the overlay permission is granted. If permission
is later revoked, remove the overlay, retain settings, and expose Retry Permission.

Register the foreground service with `foregroundServiceType="specialUse"` and
the required Android 14 property. The persistent notification actions are Show
Pet, Open Settings, and Quit in both locales.

- [ ] **Step 4: Run permission, host, and desktop localization tests GREEN**

Run: `npm run test:run -- src/android src/i18n src/app/CapabilityStatus.test.tsx && npm run android:test:native`

Expected: PASS with denied, granted, revoked, and resumed states; existing desktop copy is unchanged.

- [ ] **Step 5: Commit onboarding and permissions**

```bash
git add src/android src/i18n android/app/src/main/java/io/elevenlabs/codexpetpause/bridge android/app/src/main/AndroidManifest.xml
git commit -m "feat: guide Android overlay permissions"
```

### Task 8: Support Local and Petdex Pet Imports

**Files:**
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt`
- Create: `android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PendingPetArchiveStore.kt`
- Create: `android/app/src/test/java/io/elevenlabs/codexpetpause/petdex/PendingPetArchiveStoreTest.kt`
- Create: `src/android/infrastructure/androidPetImport.ts`
- Create: `src/android/infrastructure/androidPetImport.test.ts`
- Modify: `src/features/pets/components/PetLibrary.tsx`
- Modify: `src/features/pets/components/PetLibrary.test.tsx`
- Modify: `src/android/bridge/androidHost.ts`
- Modify: `android/app/src/main/java/io/elevenlabs/codexpetpause/bridge/AndroidHostPlugin.kt`

**Interfaces:**
- Consumes: existing `importPetArchive` and independent JSON/WebP validation.
- Produces: `openPetdex()`, `consumePendingArchive()`, `persistValidatedPet(...)`, and immediate `state-changed` delivery.

- [ ] **Step 1: Write failing import handoff and UI-order tests**

```ts
test('opens security preview as soon as Petdex download completes', async () => {
  const host = androidHostWithPendingArchive(validZipBytes());
  renderAndroidPetLibrary(host);
  host.emit({ type: 'pet-archive-ready', token: 'download-1' });
  expect(await screen.findByRole('dialog', { name: '宠物安全预览' })).toBeVisible();
});

test('places manual import below Petdex with equal button width', () => {
  renderAndroidPetLibrary();
  const buttons = screen.getAllByTestId('android-pet-import-action');
  expect(buttons.map((button) => button.textContent)).toEqual([
    '浏览 Petdex 并自动导入',
    '导入 Codex 宠物',
  ]);
});
```

```kotlin
@Test fun oversizedDownloadIsDeletedBeforeWebViewHandoff() {
  assertFailsWith<ArchiveTooLarge> { store.accept(streamLargerThanLimit()) }
  assertTrue(store.pendingFiles().isEmpty())
}
```

- [ ] **Step 2: Run import tests and verify RED**

Run: `npm run test:run -- src/android/infrastructure/androidPetImport.test.ts src/features/pets/components/PetLibrary.test.tsx`

Run: `cd android && ./gradlew testDebugUnitTest --tests '*PendingPetArchiveStoreTest'`

Expected: FAIL because Android Petdex handoff and pending archive store are absent.

- [ ] **Step 3: Implement sandboxed browsing and immediate secure preview**

Allow `https://petdex.dev/` navigation only, disable Node/file access, reject
non-HTTPS redirects, and intercept ZIP responses through Android's download
listener. Stream to a bounded private temporary file, emit `pet-archive-ready`
while Petdex remains open, and pass bytes into the existing ZIP validator.

After preview acceptance, atomically persist `pet.json` and
`spritesheet.webp`, call `selectPet(id)`, and emit `state-changed` to the overlay.
On any failure delete the temporary archive and keep the active pet unchanged.
Manual ZIP and separate JSON/WebP selection use the Android document picker and
the same validation/persistence path.

- [ ] **Step 4: Run Android and existing archive security suites GREEN**

Run: `npm run test:run -- src/android/infrastructure/androidPetImport.test.ts src/features/pets/domain/importPet.test.ts src/features/pets/domain/importPetArchive.test.ts src/features/pets/components/PetLibrary.test.tsx && npm run android:test:native`

Expected: PASS for nested folders, encrypted archives, traversal, size/count limits, invalid atlas, and immediate active-pet switching.

- [ ] **Step 5: Commit Android imports**

```bash
git add android/app/src/main/java/io/elevenlabs/codexpetpause/petdex android/app/src/test/java/io/elevenlabs/codexpetpause/petdex src/android/infrastructure src/features/pets/components
git commit -m "feat: import Android pets from files and Petdex"
```

### Task 9: Add Device-Level Instrumentation Coverage

**Files:**
- Create: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/OverlayGestureTest.kt`
- Create: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/ReminderFlowTest.kt`
- Create: `android/app/src/androidTest/java/io/elevenlabs/codexpetpause/PetImportPersistenceTest.kt`
- Modify: `android/app/build.gradle`

**Interfaces:**
- Consumes: completed Activity, bridge, service, overlay, reminders, and imports.
- Produces: emulator acceptance coverage for the complete Android user path.

- [ ] **Step 1: Add failing instrumentation scenarios**

```kotlin
@Test fun dragSnapOutwardSwipeRestoreAndDetach() {
  launchConfiguredActivity()
  grantOverlayPermission()
  dragPetToRightEdge()
  assertPetFullyVisibleAtRightEdge()
  waitSeconds(5)
  assertPetFullyVisibleAtRightEdge()
  swipePetOutward()
  assertPetPartiallyVisible()
  tapVisiblePetPortion()
  assertPetFullyVisibleAtRightEdge()
  dragPetTowardCenter()
  assertPetFreeAtExpectedPointerOffset()
}
```

```kotlin
@Test fun completionAdvancesThenCloses() {
  seedTwoDueReminders()
  tapPet()
  tapDoItNowAndComplete()
  assertSecondReminderVisible()
  tapDoItNowAndComplete()
  assertReminderBubbleAbsent()
}
```

- [ ] **Step 2: Run on an API 28 emulator and verify failures expose missing hooks**

Run: `npm run android:sync && cd android && ./gradlew connectedDebugAndroidTest`

Expected: FAIL until stable test IDs, fake clock injection, and service-idling hooks are connected.

- [ ] **Step 3: Add deterministic test hooks restricted to debug builds**

Use a debug-only `TestClock`, an in-memory notification sink, explicit overlay
view tags, and Espresso idling resources. Production builds must not register
the test bridge or expose clock mutation.

```kotlin
if (BuildConfig.DEBUG && intent.hasExtra("testClock")) {
  dependencies.clock = TestClock(intent.getLongExtra("testClock", 0L))
}
```

- [ ] **Step 4: Run instrumentation across required APIs GREEN**

Run the suite on API 28, 31, 33, and the latest installed stable API in portrait
and run the geometry subset once in landscape.

Expected: PASS for gestures, permission refusal/retry, background reminder,
queue completion, import/use, relaunch persistence, and orientation clamping.

- [ ] **Step 5: Commit instrumentation coverage**

```bash
git add android/app/src/androidTest android/app/build.gradle android/app/src/debug
git commit -m "test: cover Android floating pet flows"
```

### Task 10: Package, Document, and Release the APK Without Desktop Regressions

**Files:**
- Create: `.github/workflows/build-android.yml`
- Modify: `.github/workflows/build-desktop.yml`
- Create: `scripts/verify-android-release.mjs`
- Create: `scripts/verify-android-release.test.mjs`
- Modify: `scripts/verify-desktop-workflow.test.mjs`
- Create: `docs/ANDROID-INSTALL.md`
- Create: `docs/ANDROID-INSTALL.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Gradle `assembleRelease`, encrypted `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD` secrets.
- Produces: `Codex-Pet-Pause-<version>-android-universal.apk` plus `.sha256` in the same coordinated tagged GitHub Release as the complete desktop asset set.

- [ ] **Step 1: Write failing artifact and workflow tests**

```js
test('accepts exactly one signed arm64 APK and matching digest', async () => {
  const result = await verifyAndroidRelease(fixtureDir, '0.3.0');
  assert.deepEqual(result.assets, [
    'Codex-Pet-Pause-0.3.0-android-universal.apk',
    'Codex-Pet-Pause-0.3.0-android-universal.apk.sha256',
  ]);
});

test('rejects an unsigned or universal APK', async () => {
  await assert.rejects(() => verifyAndroidRelease(unsignedFixture, '0.3.0'));
});
```

- [ ] **Step 2: Run release tests and verify RED**

Run: `node --test scripts/verify-android-release.test.mjs`

Expected: FAIL because the Android release verifier and workflow are absent.

- [ ] **Step 3: Implement signed APK workflow and user documentation**

The workflow must:

1. Run on pull requests, `main`, tags matching `v*`, and manual dispatch.
2. Install Node 22, Java 21, and the Android SDK.
3. Run `npm ci`, TypeScript/Vitest Android tests, `npm run android:sync`, Gradle unit tests, and lint.
4. On tags, decode the keystore into the runner temp directory, build only the arm64 release APK, run `apksigner verify --print-certs`, rename it deterministically, and write `sha256sum` output.
5. Upload an Actions artifact on every successful build.
6. On tags, upload APK and digest with `gh release upload --clobber` using only the two exact Android paths.

Change the desktop workflow's existing Release cleanup loop to match only
`Codex-Pet-Pause-*-mac-*.dmg`, `Codex-Pet-Pause-*-windows-*.exe`,
`Codex-Pet-Pause-*-linux-*.AppImage`, and `Codex-Pet-Pause-*-linux-*.deb`.
Extend `verify-desktop-workflow.test.mjs` with an Android fixture asset and assert
that the cleanup filter does not select it. This is a release-safety correction;
desktop build matrices, commands, artifact names, and binaries stay unchanged.

Configure the release build with `abiFilters 'universal pure-JVM/WebView'` and bump the shared
application version to `0.3.0` before creating tag `v0.3.0`.

Document sideload installation, unknown-source permission, notification and
overlay permission, the persistent service notification, Show Pet, Hide Pet,
Quit, local persistence, update behavior, and Android power-management guidance
in complete Chinese and English.

- [ ] **Step 4: Run the complete release gate GREEN**

Run:

```bash
npm run typecheck
npm run test:run
npm run android:test:native
npm run android:build:web
npm run android:sync
cd android && ./gradlew lintDebug assembleDebug && cd ..
node --test scripts/verify-android-release.test.mjs scripts/verify-desktop-workflow.test.mjs
npm run check:desktop-release
```

Expected: all TypeScript, Android native, Android build, web, Electron, desktop
packaging, Playwright, localization, import security, and release tests pass.

- [ ] **Step 5: Perform device acceptance before publishing**

Install the signed APK on one physical arm64 phone. Verify: fresh onboarding,
permission denial/retry, medium default size, single tap, lag-free drag, double
tap menu, edge snap without automatic hiding, second outward swipe retraction,
restore, full hide/notification restore, Activity closure, two queued reminders,
custom reminder, reboot recovery, ZIP import, Petdex immediate preview, active
pet switching, custom-pet system sound, relaunch persistence, portrait, and
landscape. Record Android version and results in the release PR.

- [ ] **Step 6: Commit release automation and documentation**

```bash
git add .github/workflows/build-android.yml .github/workflows/build-desktop.yml scripts/verify-android-release.mjs scripts/verify-android-release.test.mjs scripts/verify-desktop-workflow.test.mjs docs/ANDROID-INSTALL.md docs/ANDROID-INSTALL.zh-CN.md README.md README.zh-CN.md package.json package-lock.json
git commit -m "build: package signed Android releases"
```

## Final Review Checklist

- [ ] Android code is reachable only through the Android build host and Android package.
- [ ] Electron files and desktop CSS have no Android-specific branches.
- [ ] The pet stays where placed and snaps only after an edge drag.
- [ ] An attached pet retracts only after a second outward swipe.
- [ ] Buttons fit the safe phone area and no reminder action requires scrolling.
- [ ] Settings and imported pets survive Activity closure, service restoration, relaunch, and upgrade.
- [ ] The APK is signed, universal, reproducibly named, and accompanied by SHA-256.
- [ ] The complete existing desktop release gate passes before tagging.

Android backup is disabled for app-private settings, history, reminder state, and imported pets; same-key in-place APK upgrades still preserve local data.
