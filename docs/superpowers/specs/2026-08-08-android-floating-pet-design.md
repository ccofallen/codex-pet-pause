# Codex Pet Pause Android Floating Pet Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning

## 1. Goal

Add an Android edition of Codex Pet Pause that preserves the accepted reminder,
pet import, localization, persistence, and interaction behavior while presenting
the pet as a system overlay above other applications. The first Android release
is distributed as a signed APK through GitHub Releases.

The Android work must not change the behavior, packaging, persistence, or visual
layout of the existing macOS, Windows, Linux, or web editions.

## 2. Chosen Approach

Use Capacitor as the Android application shell around the existing React/Vite
application, with focused Kotlin modules for capabilities that a WebView cannot
provide reliably:

- a foreground service for the persistent pet and reminder lifecycle;
- a `WindowManager` overlay for rendering above other applications;
- native reminder scheduling and recovery;
- an Android data bridge shared by the settings Activity and overlay renderer;
- file selection and intercepted Petdex ZIP downloads;
- Android permissions, notifications, boot restoration, and release packaging.

The existing Electron application remains a separate host. Android-specific
code is selected through a dedicated Android entry point and capability adapter,
never through changes to Electron window behavior.

## 3. Application Components

### 3.1 Settings Activity

The main Capacitor Activity hosts the existing settings, reminders, insights,
localization, and pet library experience with a phone-responsive layout.
Primary actions use a bottom thumb zone. Secondary content scrolls above those
actions. The pet is not duplicated inside settings while the system overlay is
active.

### 3.2 Pet Overlay Service

A Kotlin foreground service owns the pet lifecycle after setup is closed. It
creates a transparent `TYPE_APPLICATION_OVERLAY` window sized only to the pet,
menu, or reminder bubble that is currently visible. Transparent unused screen
area must not intercept touches in other applications.

The renderer reuses the accepted pet animation and reminder presentation logic.
The host dynamically resizes and repositions the overlay bounds when a menu or
bubble opens, preventing the large invisible-window problems previously solved
on desktop.

### 3.3 Reminder Scheduler

Reminder timing is native and does not depend on an Activity or WebView staying
open. The foreground service persists each next-due time, recalculates pending
work after process restoration, and resumes enabled reminders after reboot when
the user has permitted it.

At reminder time the app plays the configured sound, publishes an Android
notification, and shows a bubble beside the pet. The built-in cat uses the cat
sound; an imported pet uses the Android system alert sound.

### 3.4 Local Data Bridge

Settings, reminder state, history, selected-pet metadata, and imported assets
use versioned application-private storage. The Activity and overlay service
consume the same authoritative snapshot through an explicit Kotlin/TypeScript
bridge. Updates are delivered immediately in both directions.

The storage adapter preserves existing domain interfaces so shared reminder and
pet logic does not need to know whether the host is Android, Electron, or web.
Upgrades retain settings and imported pets. Uninstalling or clearing application
data removes them.

## 4. Mobile Layout

The Android UI follows these size and placement rules:

- Small pet: approximately `56dp`.
- Medium pet: approximately `72dp` and the default on phones.
- Large pet: approximately `96dp`.
- Reminder bubble width never exceeds the safe screen width.
- Reminder content does not require internal scrolling to reach its actions.
- Reminder actions remain at the bottom of the bubble with at least `48dp`
  touch height.
- Main settings actions remain in the bottom thumb zone.
- Overlay placement respects status bars, display cutouts, navigation bars,
  gesture insets, orientation changes, and tablet dimensions.

## 5. Gestures and Overlay Behavior

- Single tap interacts with the pet. When a reminder is pending, it opens the
  reminder bubble.
- Drag moves the pet without offset, jump, flicker, or perceptible lag.
- Double tap opens a compact menu beside the pet with Settings, Hide Pet, and
  Quit. The menu expands toward available screen space and avoids system edges.
- Single-tap handling may wait approximately 250 milliseconds to distinguish a
  double tap.
- A pet left away from an edge remains exactly where the user placed it.
- Dragging into an edge snap zone attaches the pet to that edge while keeping it
  fully visible.
- An attached pet stays fully visible indefinitely. It does not auto-hide.
- Only a second outward swipe while attached retracts the pet until a small,
  tappable portion remains visible.
- Tapping the visible portion restores the full pet at the edge.
- Dragging inward detaches the pet and leaves it at the new position.
- Hide Pet fully removes the overlay. The foreground notification provides a
  Show Pet action.
- Quit stops the overlay and background reminder service.

## 6. Reminder Flow

- Reminders continue while the settings Activity is closed.
- A due reminder produces the system notification, configured sound, and pet
  bubble.
- The bubble provides Snooze and Do It Now in the bottom action row.
- Completing the current reminder immediately advances to the next queued
  reminder. If the queue is empty, the bubble closes without a third layer.
- Multiple due reminders preserve their accepted order.
- Custom reminders and quiet hours behave as on the accepted desktop edition.
- Restart and process recovery use persisted due times rather than resetting
  countdowns.

## 7. Pet Import and Petdex

Android retains all current import capabilities:

- Codex-compatible ZIP pet packages;
- nested folders containing `pet.json` and `spritesheet.webp`;
- separate `pet.json` and WebP selection;
- archive size, extracted size, file count, encryption, dangerous path, schema,
  spritesheet integrity, and pixel safety checks;
- bilingual instructions, errors, and security preview.

Petdex opens inside a sandboxed application browser. A ZIP download is
intercepted immediately and opens the security preview without requiring the
Petdex page to close. Accepting and selecting Use updates the active overlay pet
immediately. A rejected or invalid package leaves the current pet untouched.

No imported asset is uploaded to a server.

## 8. Permissions and Onboarding

Initial setup requests capabilities in context:

1. Configure reminders and choose a pet.
2. Request notification permission where required.
3. Explain and request Display Over Other Apps permission.
4. Start the overlay and foreground reminder service.

Refusing a permission never creates a blank or blocked page. The application
continues to support settings, history, and imports and provides a clear Retry
Permission action. Revoked overlay permission stops overlay creation safely and
surfaces recovery guidance through the Activity and notification.

The foreground-service notification states that Codex Pet Pause is running and
offers Show Pet, Open Settings, and Quit actions.

## 9. Compatibility and Distribution

- Minimum supported system: Android 9 / API 28.
- Initial artifact: signed `arm64-v8a` APK.
- Distribution: GitHub Releases, alongside desktop artifacts.
- Release assets include a SHA-256 digest.
- Signing credentials are stored only as encrypted GitHub Actions secrets and
  are never committed.

## 10. Failure Handling

- Missing or revoked overlay permission cannot create a partial overlay.
- Invalid pet files preserve the currently selected pet.
- Renderer or bridge failure falls back to the built-in cat and records a local
  diagnostic without uploading telemetry.
- Process restoration reloads persisted next-due times and active-pet state.
- Orientation and display changes clamp coordinates into the current safe area.
- Petdex download failures remain visible in the current page with a retry path.
- Android power-management restrictions are explained without claiming that the
  user has closed a browser or disabled reminders.

## 11. Testing and Desktop Protection

Android coverage includes:

- TypeScript unit tests for shared reminder, import, settings, translation, and
  storage-adapter behavior;
- Kotlin unit tests for permissions, coordinate clamping, edge snapping,
  outward-swipe hiding, reminder restoration, and bridge synchronization;
- Android instrumentation tests for tap, double tap, drag, menu placement,
  bubble actions, Activity/overlay synchronization, and file import;
- emulator checks on Android 9, 12, 13, and the latest stable API;
- APK install, relaunch, upgrade-persistence, and SHA-256 checks.

Desktop protection is a required release gate:

- Electron entry points and window policies remain unchanged unless a separate
  desktop bug explicitly requires a change.
- Android CSS is scoped to the Android root and cannot alter desktop selectors.
- Android storage, permission, and lifecycle adapters are injected only in the
  Android entry point.
- Existing web and complete desktop release checks must pass before an Android
  release can be tagged.
- GitHub Actions builds Android independently, so a failed Android build cannot
  replace or corrupt desktop artifacts.

## 12. Acceptance Criteria

1. A user installs the GitHub APK and can configure the application without a
   terminal or account.
2. After permission is granted, the pet remains visible above other apps while
   settings is closed.
3. The medium default pet and all buttons fit a phone screen without clipped or
   scroll-hidden actions.
4. Single tap, drag, double tap, edge snap, outward-swipe retract, restore, full
   hide, and quit follow the approved gesture model.
5. Background reminders survive Activity closure, app process recovery, reboot,
   and application upgrade as allowed by Android.
6. Reminder completion advances to the next due reminder or closes immediately.
7. Local and Petdex imports pass the existing security checks and switch the
   overlay pet immediately.
8. Settings, imported pets, and history remain local and persist across relaunch.
9. Existing macOS, Windows, Linux, and web behavior and release artifacts pass
   their complete regression gates unchanged.
