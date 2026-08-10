# Android Overlay Stability Design

## Objective

Repair the Android application so pet size, menu presentation, dragging, hiding, reminder sound, app state, and branding are deterministic. The changes must remain isolated to Android and must not alter macOS, Windows, Linux, or the shared web application behavior.

## Confirmed Product Behavior

- A double tap opens a correctly sized menu without resizing the pet.
- The pet remains at the selected small, medium, or large size until the user changes that setting.
- Dragging changes position only. It must not resize or flash the overlay.
- Hiding the pet removes the overlay immediately and keeps it hidden, even when a reminder is due.
- Reminders continue in the background and use Android system notifications while the pet is hidden.
- The app page always displays the action matching native state: `Hide pet` when visible and `Show pet` when hidden.
- Enabled reminder sounds use the Android system default notification sound for both the built-in cat and imported pets.
- The Android launcher artwork matches the desktop Codex Pet Pause cat brand.
- A tap and drag use the same pet interaction animations as the desktop and web versions.
- Petdex blob downloads are imported through a bounded private bridge without widening page navigation.

## Root Causes

### Surface mode corruption

The renderer emits a generic `bubble-size-changed` message for both the menu and reminder bubble. The native service interprets every such message as a reminder bubble resize and switches the surface mode to `BUBBLE`. ResizeObserver callbacks generated while the native WebView is itself being resized can therefore overwrite a newer mode and shrink the window.

### Geometry feedback during dragging

Drag events update position and dimensions together. Reapplying the same dimensions through WindowManager for every pointer move causes unnecessary WebView relayouts and visible flashing.

### Hidden overlay reopened by reminder reconciliation

The hide command removes the overlay, then reminder reconciliation may immediately call the reminder-bubble path. That path unconditionally recreates the overlay, violating the user's hidden state.

### Missing state propagation

Menu actions run inside the overlay service, while the app page keeps a local capability snapshot owned by the Capacitor plugin. The service does not broadcast visibility changes, so the app page can retain stale button text.

### Notification channel mismatch

The built-in cat uses a custom sound channel while imported pets use a system-sound channel. Android notification channel sound choices are persistent, so changing an existing channel is unreliable. A new system-default channel version is required.

### Brand asset mismatch

Android launcher resources still use generic Capacitor artwork instead of the canonical desktop cat icon.

## Architecture

### Mode-aware surface protocol

The overlay service remains authoritative for native window geometry. Surface modes are `PET`, `MENU`, and `BUBBLE`.

- `PET` dimensions are derived only from the persisted pet-size setting.
- `MENU` uses deterministic native dimensions and does not accept renderer resize messages.
- `BUBBLE` may accept measured content dimensions only when the message contains the current surface generation and `mode: BUBBLE`.
- Every transition increments a surface generation. Delayed messages from older generations are ignored.
- Native mode and generation are included in renderer commands so the renderer can report an attributable measurement.

### Position and size separation

WindowManager operations are split into position-only updates and dimension-changing updates. Dragging and edge snapping use position-only updates. Mode transitions and explicit pet-size changes are the only paths allowed to update dimensions.

### Visibility as native shared state

The persisted Android lifecycle state remains the source of truth. Every visibility transition publishes a process-local visibility event. The Capacitor plugin forwards that event as `capabilitiesChanged`; the app page updates immediately without waiting for Activity recreation.

Hidden state has priority over reminder presentation. Reminder reconciliation may post a system notification while hidden, but cannot create or reveal the overlay. A subsequent explicit show action may display the pet or pending reminder.

### System notification sound

All sound-enabled reminders use a new system-default notification channel. Silent reminders remain on the silent channel. Web audio remains disabled on Android so one reminder cannot produce duplicate sounds.

### Android brand assets

The canonical desktop cat artwork is used to generate adaptive foreground/background resources and legacy launcher PNGs. Artwork stays inside Android's adaptive-icon safe zone. A monochrome cat notification icon is used for status-bar notifications.

## Testing Strategy

### Pet interaction and Petdex import

- Default cat tap uses `review`; imported pet tap uses `waving`.
- Default cat drag uses `picked-up`; imported pet drag uses directional running animation.
- Double tap does not emit ordinary tap animations.
- Only `blob:https://petdex.dev/` ZIP downloads with safe metadata enter the private import store.
- Completing a Petdex download closes the isolated browser task and reveals the import preview.

### JVM unit tests

- Hiding while a reminder is due keeps the overlay absent and still schedules/posts the notification path.
- A menu surface rejects bubble resize messages.
- A stale generation cannot resize or change the current surface.
- Drag updates do not change width or height.
- Visibility transitions publish exactly one state event.
- Built-in and imported pets both select the new system-default sound channel.

### Renderer tests

- Size reports include `mode: BUBBLE` and the active generation.
- Menu rendering never emits a bubble measurement.
- Capability events immediately change `Hide pet` to `Show pet` and back.

### Instrumented Android acceptance tests

- Repeated double tap/open/close cycles preserve pet dimensions.
- Dragging does not change dimensions or produce overlay recreation.
- Menu hide removes the overlay; opening the app shows `Show pet`.
- A due reminder while hidden leaves the overlay hidden and posts a system notification.
- Launcher and notification resources resolve successfully.

### Regression verification

- Run TypeScript unit tests and production build.
- Run Android JVM tests, lint, debug build, and connected instrumentation tests when a device is available.
- Confirm desktop production build remains successful without modifying desktop runtime files.

## Non-goals

- No redesign of desktop overlays.
- No change to reminder scheduling semantics beyond hidden-overlay presentation.
- No new custom Android sound picker.
- No native rewrite of the WebView menu.
