# Linux Workspaces and Desktop Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Linux pet visible across workspaces and show accurate background-reminder status in packaged settings windows.

**Architecture:** A pure Electron window-policy function owns platform differences and is applied only to the pet window. `CapabilityStatus` receives an explicit desktop-host flag from `AppShell`, preserving browser behavior while replacing browser-only lifecycle guidance in Electron.

**Tech Stack:** Electron 35, React 19, TypeScript, Vitest, Testing Library, Playwright, electron-builder

## Global Constraints

- Linux pet window is non-focusable, remains pointer-interactive, and stays visible across workspaces.
- macOS all-spaces and fullscreen behavior remains unchanged.
- Windows stays always on top in the current virtual desktop; no native virtual-desktop module is added.
- Settings windows remain focusable on every platform.
- Browser capability guidance remains unchanged.
- Electron settings omit PWA readiness, document visibility, and browser-close warnings.
- Chinese desktop copy is `桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。`
- English desktop copy is `The desktop app keeps running in the background. Reminders continue after you close the settings window.`
- Release version is `0.2.2`.

---

### Task 1: Platform-specific pet window policy

**Files:**
- Create: `electron/window-policy.js`
- Create: `electron/window-policy.test.js`
- Modify: `electron/main.js`
- Modify: `electron/main.test.js`

**Interfaces:**
- Produces: `resolvePetWindowPolicy(platform: NodeJS.Platform): { focusable: boolean }`
- Consumes: Electron `BrowserWindow` constructor options and `setVisibleOnAllWorkspaces`

- [ ] **Step 1: Write the failing pure-policy tests**

```js
import { describe, expect, it } from 'vitest';
import { resolvePetWindowPolicy } from './window-policy.js';

describe('pet window platform policy', () => {
  it('makes the Linux pet non-focusable so it follows every workspace', () => {
    expect(resolvePetWindowPolicy('linux')).toEqual({ focusable: false });
  });

  it.each(['darwin', 'win32'])('keeps the %s pet focusable', (platform) => {
    expect(resolvePetWindowPolicy(platform)).toEqual({ focusable: true });
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `npx vitest run electron/window-policy.test.js`

Expected: FAIL because `electron/window-policy.js` does not exist.

- [ ] **Step 3: Implement the minimal policy**

```js
export function resolvePetWindowPolicy(platform) {
  return {
    focusable: platform !== 'linux',
  };
}
```

- [ ] **Step 4: Apply the policy to the pet window only**

Import `resolvePetWindowPolicy` in `electron/main.js` and spread
`resolvePetWindowPolicy(process.platform)` into the pet `BrowserWindow`
options. Do not apply it to `settingsWindow`.

Keep:

```js
alwaysOnTop: true,
```

and keep the existing call:

```js
petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

- [ ] **Step 5: Add main-process regression assertions**

Extend `electron/main.test.js` to assert:

```js
const firstPetWindow = electron.windows[0];
expect(firstPetWindow.options.alwaysOnTop).toBe(true);
expect(firstPetWindow.options.focusable).toBe(process.platform !== 'linux');
expect(firstPetWindow.setVisibleOnAllWorkspaces)
  .toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
```

After opening settings, assert:

```js
expect(firstSettingsWindow.options.focusable).toBeUndefined();
```

- [ ] **Step 6: Run Electron tests and verify GREEN**

Run: `npm run test:electron && npx vitest run electron/window-policy.test.js`

Expected: all Electron and window-policy tests PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/window-policy.js electron/window-policy.test.js electron/main.js electron/main.test.js
git commit -m "fix: keep Linux pet across workspaces"
```

### Task 2: Desktop-specific capability guidance

**Files:**
- Modify: `src/app/CapabilityStatus.tsx`
- Modify: `src/app/CapabilityStatus.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/i18n/messages.ts`

**Interfaces:**
- Changes: `CapabilityStatus` props add `desktopShellAvailable: boolean`
- Consumes: `window.petShell !== undefined`
- Produces: translation key `capability.desktopBackground`

- [ ] **Step 1: Write failing desktop capability tests**

Extend the `renderStatus` helper to accept `desktopShellAvailable = false` and
pass it to `CapabilityStatus`.

Add a Chinese desktop test:

```tsx
test('shows native background guidance without browser lifecycle warnings', () => {
  renderStatus('granted', 'persistent', false, 'zh-CN', true);

  expect(screen.getByText('桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。')).toBeVisible();
  expect(screen.queryByText('离线启动尚未准备好')).not.toBeInTheDocument();
  expect(screen.queryByText('页面当前在前台运行')).not.toBeInTheDocument();
  expect(screen.queryByText('关闭网页或浏览器后，提醒不会继续运行。')).not.toBeInTheDocument();
});
```

Add an English desktop test:

```tsx
test('localizes native background guidance in English', () => {
  renderStatus('granted', 'persistent', false, 'en', true);

  expect(screen.getByText(
    'The desktop app keeps running in the background. Reminders continue after you close the settings window.',
  )).toBeVisible();
});
```

Keep the existing browser tests unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/app/CapabilityStatus.test.tsx`

Expected: FAIL because the new prop and localized desktop message do not exist.

- [ ] **Step 3: Add localized desktop copy**

Add to both locale maps in `src/i18n/messages.ts`:

```ts
'capability.desktopBackground': '桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。',
```

```ts
'capability.desktopBackground': 'The desktop app keeps running in the background. Reminders continue after you close the settings window.',
```

- [ ] **Step 4: Implement desktop/browser status branches**

Add the required prop:

```ts
desktopShellAvailable: boolean;
```

Render browser-only status only when `desktopShellAvailable` is false:

```tsx
{!desktopShellAvailable && !offlineReady && (
  <p>{offlineRegistrationFailed
    ? t('pwa.error.registrationUnavailable')
    : t('capability.offline.preparing')}</p>
)}
{!desktopShellAvailable && (
  <p>{visibility === 'hidden'
    ? t('capability.visibility.hidden')
    : t('capability.visibility.visible')}</p>
)}
<p>{t(desktopShellAvailable
  ? 'capability.desktopBackground'
  : 'capability.closedWarning')}</p>
```

Notification and temporary-storage warnings remain outside this branch.

- [ ] **Step 5: Pass the host capability from AppShell**

In `src/app/AppShell.tsx` pass:

```tsx
desktopShellAvailable={window.petShell !== undefined}
```

- [ ] **Step 6: Add an AppShell integration regression**

In `src/app/AppShell.test.tsx`, render the hosted settings URL with
`window.petShell` defined. Assert that the desktop background message is
visible and the browser-close warning is absent. Restore `window.petShell`
after the test.

- [ ] **Step 7: Run focused UI tests and verify GREEN**

Run:

```bash
npx vitest run src/app/CapabilityStatus.test.tsx src/app/AppShell.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/CapabilityStatus.tsx src/app/CapabilityStatus.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx src/i18n/messages.ts
git commit -m "fix: show accurate desktop reminder status"
```

### Task 3: Version, review, and release verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: package version `0.2.2` and tag `v0.2.2`

- [ ] **Step 1: Bump the package version**

Run:

```bash
npm version 0.2.2 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both report `0.2.2`.

- [ ] **Step 2: Commit the version**

```bash
git add package.json package-lock.json
git commit -m "chore: bump desktop release to 0.2.2"
```

- [ ] **Step 3: Request whole-branch code review**

Review the complete diff from `origin/main` through the branch head. Require
findings-first review covering Linux pointer interaction risk, Windows and
macOS regressions, desktop/browser copy branching, localization, and release
configuration.

- [ ] **Step 4: Run the full local release gate**

Run:

```bash
npm run check:desktop-release
```

Expected:

- TypeScript passes.
- Unit and Electron tests pass.
- All Playwright tests pass.
- Web and desktop builds pass.
- Packaged-resource smoke tests pass.

- [ ] **Step 5: Push and validate GitHub CI**

Push `fix/linux-workspaces-desktop-status`, open a pull request, and wait for
the `Build Desktop` validation job to succeed.

- [ ] **Step 6: Merge and publish**

Merge the approved pull request, tag the resulting `main` commit as `v0.2.2`,
and wait for validate, macOS ARM64, macOS x64, Windows x64, Linux x64, and
release jobs to succeed.

- [ ] **Step 7: Verify public release assets**

Confirm the release contains:

```text
Codex-Pet-Pause-0.2.2-mac-arm64.dmg
Codex-Pet-Pause-0.2.2-mac-x64.dmg
Codex-Pet-Pause-0.2.2-windows-x64.exe
Codex-Pet-Pause-0.2.2-linux-x64.AppImage
Codex-Pet-Pause-0.2.2-linux-x64.deb
```
