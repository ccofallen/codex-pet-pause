# Codex Pet Pause 0.2.2 Final Fix Report

## Status

The final review findings are addressed at the strongest maintainable
repository-owned boundaries available in the current harness. This fix wave
changes tests and this report only. It does not change production code,
dependencies, native integrations, release workflows, or files under
`release/`.

## Finding P2: Linux policy and pointer interaction

### Regression added

- `electron/main.test.js` now imports the real main process with
  `process.platform` set deterministically to `linux`.
- The test proves that the pet `BrowserWindow` receives `focusable: false`,
  retains `alwaysOnTop: true`, and receives
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
- In the same Linux-policy test, the registered `pet:drag-window` handler is
  executed against the current pet sender and must call `setPosition` with
  normalized coordinates.
- The registered `pet:show-context-menu` handler is executed against the same
  pet sender and must open the menu for that window at bounded local
  coordinates.
- `src/app/DesktopApp.test.tsx` now sends real pointer-down, pointer-move, and
  context-menu events to the rendered pet. It proves the renderer continues to
  call the desktop shell's drag and context-menu APIs.
- The existing `electron/window-policy.test.js` continues to prove that only
  Linux resolves to the non-focusable policy.

These assertions would fail if the Linux policy stopped being spread into the
pet window, if either main-process IPC channel stopped being registered or
functional, or if the renderer stopped forwarding drag or right-click input.

### TDD evidence

RED mutation:

```text
PET_PAUSE_MAIN_TEST_PLATFORM=darwin npm run test:electron -- electron/main.test.js
```

The command exited 1. The new Linux regression failed at the intended boundary:
the pet received `focusable: true` instead of `false`. The run contained one
failed and two passed tests.

GREEN:

```text
npm run test:electron -- electron/main.test.js electron/window-policy.test.js
```

The command exited 0 with 2 test files and 6 tests passing.

```text
npm run test:run -- src/app/CapabilityStatus.test.tsx src/app/DesktopApp.test.tsx
```

The command exited 0 with 2 test files and 15 tests passing.

```text
npm run typecheck
```

The command exited 0.

## Finding P3: Desktop degraded-state and PWA suppression

`src/app/CapabilityStatus.test.tsx` now covers both desktop notification
degradation states, `denied` and `unavailable`, while storage is temporary and
PWA registration has failed. Each case proves:

- the applicable notification warning remains visible;
- the temporary-storage warning remains visible;
- desktop background guidance remains visible;
- the PWA registration-failure message is suppressed;
- the PWA preparing message is suppressed;
- page-visibility and browser-close lifecycle warnings remain suppressed.

The production component already had the required branch structure, so these
characterization cases passed when first run. No production change was needed
or justified. The assertions protect the previously uncovered branches against
future regressions.

## Self-review

- The Linux test uses the real `resolvePetWindowPolicy` and main-process module,
  with Electron itself mocked at the repository boundary.
- The temporary platform override is restored in a `finally` block.
- Pointer tests assert repository-owned outcomes rather than retesting an
  Electron or desktop-environment implementation.
- The settings window's normal focusable default remains covered.
- `git diff --check` completed successfully.
- The pre-existing untracked `release/` directory was left untouched and is
  excluded from this fix wave.

## Native acceptance residual

A real packaged cross-workspace smoke test is not feasible in the existing
harness. The repository has Vitest tests with mocked Electron and browser
Playwright tests, but it does not have a packaged-app driver, Linux compositor
session provisioning, workspace-switching control, or native pointer
automation. Adding those here would introduce the large and brittle
desktop-environment dependency explicitly excluded from this fix.

The upstream behavior therefore relies on Electron's official contract:

- Electron documents that Linux `focusable: false` stops the window interacting
  with the window manager so it remains on top across workspaces:
  [BaseWindowConstructorOptions](https://www.electronjs.org/docs/latest/api/structures/base-window-options).
- Electron documents `setVisibleOnAllWorkspaces` for Linux and macOS:
  [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window/#winsetvisibleonallworkspacesvisible-options).
- Electron defines mouse-event ignoring through the separate
  `setIgnoreMouseEvents` API. This application does not enable it, while the
  repository tests prove that its renderer and main-process pointer paths
  remain active.

The remaining native uncertainty is precise:

- No automated evidence switches real X11 workspaces or confirms pointer
  delivery from a specific X11 window manager to the packaged non-focusable
  window.
- No automated evidence switches real Wayland workspaces or confirms pointer
  delivery from a specific compositor to the packaged non-focusable window.
- Electron documents that `setPosition` is unsupported on Wayland. The
  repository regression proves that drag IPC remains enabled and reaches
  Electron, but it cannot guarantee that a native Wayland compositor moves the
  window.
- Packaged AppImage and DEB acceptance on representative X11 and Wayland
  sessions remains a manual or release-infrastructure follow-up, not a claim
  made by this test wave.

## Release boundary

This fix wave runs focused repository tests only. The release controller still
owns the full `npm run check:desktop-release`, GitHub validation, packaging,
signing, and artifact-job evidence required before publishing `v0.2.2`.
