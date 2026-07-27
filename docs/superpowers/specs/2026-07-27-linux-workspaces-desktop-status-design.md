# Linux Workspaces and Desktop Status Design

## Goal

Make the Linux desktop pet visible on every workspace and replace browser-only
capability warnings with accurate desktop-app guidance in packaged settings
windows.

## Platform behavior

### Linux

The pet window will be non-focusable on Linux. Electron documents this window
policy as staying on top across all workspaces. The settings window remains a
normal focusable window.

The pet must retain pointer interaction through the renderer and existing IPC:
dragging, activation, reminder actions, and the right-click menu continue to
work. Keyboard focus on the Linux pet window is not guaranteed because it
conflicts with the all-workspaces window policy.

The existing `setVisibleOnAllWorkspaces(true)` call remains as a compatible
signal for Linux window managers that support it.

### macOS

The existing all-spaces and fullscreen behavior remains unchanged.

### Windows

The pet remains always on top in the current Windows virtual desktop. Electron
does not support pinning a window to every Windows virtual desktop, so this
change will not add a native module based on undocumented Windows APIs.

## Settings capability status

`CapabilityStatus` will distinguish a browser renderer from an Electron
renderer through an explicit prop supplied by `AppShell`.

In an Electron settings window:

- Browser-only PWA readiness, page visibility, and browser-close warnings are
  omitted.
- A localized desktop message states that the app continues running in the
  background after the settings window closes.
- Real degraded-state warnings, such as temporary storage or unavailable
  notifications, remain visible.

In a browser, the current capability status and warnings remain unchanged.

Chinese desktop copy:

> 桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。

English desktop copy:

> The desktop app keeps running in the background. Reminders continue after you
> close the settings window.

## Testing

- Add a pure, platform-specific pet-window policy and test Linux, macOS, and
  Windows behavior without changing the host test process platform.
- Verify the Electron main process applies both the platform policy and the
  all-workspaces API.
- Add `CapabilityStatus` tests for Chinese and English desktop renderers.
- Preserve existing browser capability-status tests.
- Run the full desktop release gate before publishing.

## Release

After review and successful local and GitHub validation, publish the fix as
`v0.2.2` with the existing macOS ARM64, macOS x64, Windows x64, Linux AppImage,
and Linux DEB artifacts.
