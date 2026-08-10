# Android Detached Overlay Surfaces Design

## Goal

Eliminate pet movement and flashing when Android opens or closes a menu or reminder bubble, including when the pet is attached near the right edge. Also eliminate the race where a reminder reaches zero but tapping the pet does not open its bubble.

## Scope

This change is Android-only. It must not change desktop Electron behavior, web behavior, Petdex import, stored settings, pet assets, reminder schedules, drag gestures, edge attachment, pet sizing, or pet animation selection.

## Root Causes

The Android implementation currently renders the pet and its expanded surface in one WebView overlay window. A right-side surface expands toward the left, so WindowManager moves and resizes that window while React independently adds or removes menu or bubble content. Those operations cannot commit atomically and briefly place the pet at the expanded window origin.

At a reminder deadline, the visible countdown can reach zero immediately before the service timer reconciles the persisted reminder into the pending queue. A tap during that interval is treated as an ordinary pet interaction.

## Architecture

### Pet window

The existing pet WebView remains a permanently small overlay window while the pet is visible. It retains ownership of:

- Pet rendering and animation.
- Single tap, double tap, drag, snap, retract, and restore gestures.
- Pet placement persistence.
- Pet size changes.
- Renderer recovery for the pet surface.

Opening or closing another surface must never resize, reposition, recreate, hide, translate, or change the layout of this window.

### Detached surface window

A new Android overlay-surface controller owns one optional transparent WebView window. It displays either MENU or BUBBLE, never both. It has no pet DOM and receives only the state needed by the active surface.

The controller positions the surface next to the fixed pet bounds:

- A pet on the left opens the surface to its right.
- A pet on the right opens the surface to its left.
- Vertical placement is clamped to safe display bounds.
- Surface size is clamped before WindowManager receives layout parameters.

Closing a surface removes only the detached surface window. The pet window is untouched.

### Rendering contract

The Android overlay entry point supports an explicit surface-only mode. In this mode it renders no pet element and emits a measured intrinsic size after React layout.

Native messages identify the mode and generation. Stale measurements, acknowledgements, and actions from an older generation are ignored. Repeated open requests for the same generation are idempotent.

### Input behavior

Double tapping the pet opens MENU. While MENU is visible, tapping the pet closes MENU. Selecting Settings closes MENU before opening the activity. Hide and Quit preserve their existing lifecycle semantics.

Tapping a pet with a pending or newly due reminder opens BUBBLE. Menu and bubble surfaces are mutually exclusive. Bubble actions preserve the existing complete, skip, snooze, and next-reminder behavior.

### Reminder deadline reconciliation

Before deciding whether a single tap is a pet interaction or a reminder action, the service reconciles reminders against the current clock. The tap opens BUBBLE when reconciliation creates or preserves a pending reminder. Reconciliation remains idempotent and uses the existing reminder engine and scheduler.

## Lifecycle and Recovery

- Hiding the pet removes both windows and cancels pending surface callbacks.
- Quitting removes both windows and retains existing application shutdown behavior.
- Renderer loss is tracked independently for the pet and detached surface WebViews.
- Surface recovery restores only the currently active MENU or BUBBLE generation.
- A close, hide, or quit request cancels queued surface recreation.
- Display and density changes reflow both windows from the same persisted pet placement without writing a new placement unless the pet itself moved.

## Failure Handling

- If the detached WebView cannot be created, the pet remains visible and interactive.
- Invalid or stale surface messages are ignored.
- Invalid measured sizes never reach WindowManager.
- Surface creation failure must not restart or resize the pet window.
- A reminder remains pending if its bubble cannot be displayed, so the next tap can retry.

## Compatibility Constraints

- No changes to Electron main, preload, desktop renderer, or desktop packaging paths.
- No changes to web reminder behavior or web layout.
- No state-schema migration.
- No changes to imported pet storage or Petdex processes.
- Existing Android settings and imported pets continue to load without conversion.

## Tests

### Unit and component tests

- Surface controller creates one detached window and replaces MENU with BUBBLE without touching pet layout parameters.
- Closing MENU or BUBBLE removes only the detached window.
- Left and right placement calculations preserve identical pet bounds.
- Stale generation messages are ignored.
- Hide, quit, and renderer recovery cancel pending detached-surface work.
- A tap at the exact reminder deadline reconciles and opens BUBBLE.
- A tap before the deadline remains a normal pet interaction.
- React surface-only mode contains no pet DOM and reports intrinsic dimensions.

### Instrumented tests

- Record pet bounds before, during, and after MENU open/close on both screen edges; every bound must be identical.
- Record pet bounds before, during, and after BUBBLE open/close on both screen edges; every bound must be identical.
- Repeat each transition ten times and compare screenshots for pet displacement or missing frames.
- Verify consecutive pending reminders advance without recreating or moving the pet window.
- Verify a reminder tapped at zero seconds opens reliably.
- Exercise hide, show, background, foreground, rotation, and renderer recovery.

### Regression gate

- Full TypeScript tests and typecheck.
- Android JVM tests, lint, debug and release assembly.
- All Android instrumented tests.
- Release APK install and launcher-icon smoke test.
- Fresh log audit for app-owned fatal exceptions, ANRs, renderer failures, and lifecycle loops.

## Acceptance Criteria

- Pet bounds do not change by even one pixel when MENU or BUBBLE opens or closes on either side of the screen.
- No visible pet flash, slide, disappearance, or duplicate pet occurs during surface transitions.
- A tap at or after the displayed zero-second deadline opens the reminder bubble.
- Existing drag, snap, retract, restore, size, import, reminder action, and persistence tests remain green.
- Desktop and web build outputs contain no behavior changes from this Android-only implementation.
