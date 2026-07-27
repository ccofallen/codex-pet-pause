# Windows Pet Title Strip Design

## Goal

Prevent the Windows desktop pet from exposing a native title strip after the
user clicks the pet and then switches to another application.

## Root Cause

The pet `BrowserWindow` is frameless, but the Windows platform policy still
allows it to receive focus. After focus moves away, Windows can expose the
window title associated with the focused transparent window.

## Design

Make only the Windows pet window non-focusable through
`resolvePetWindowPolicy`. Mouse input, dragging, reminders, and the native
context menu continue to use the existing renderer and IPC paths. The settings
window is a separate `BrowserWindow` and is unaffected.

The final policy is:

- `darwin`: `focusable: true` (unchanged)
- `linux`: `focusable: false` (unchanged)
- `win32`: `focusable: false` (changed)

The page title and ElevenLabs attribution remain unchanged because the defect
is the appearance of native window chrome, not the attribution content.

## Verification

Add a policy regression test for Windows and retain explicit tests for macOS
and Linux. Run the Electron test suite and the complete desktop release gate.
Publish the fix as `v0.2.3` only after all automated checks pass.
