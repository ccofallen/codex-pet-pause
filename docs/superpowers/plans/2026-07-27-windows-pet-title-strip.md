# Windows Pet Title Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Windows pet's focus-related title strip without changing macOS or Linux behavior.

**Architecture:** Keep the existing platform policy boundary and change only the `win32` focusability result. The pet window already consumes this policy, while the settings window does not.

**Tech Stack:** Electron 35, JavaScript, Vitest, electron-builder

## Global Constraints

- macOS behavior must not change.
- Linux behavior must not change.
- The settings window must retain its normal title bar.
- The release version is `0.2.3`.

---

### Task 1: Windows pet focus policy

**Files:**
- Modify: `electron/window-policy.js`
- Test: `electron/window-policy.test.js`

**Interfaces:**
- Consumes: `resolvePetWindowPolicy(platform: string)`
- Produces: `{ focusable: boolean }` with `false` for `win32` and `linux`, and `true` for `darwin`

- [x] **Step 1: Run a failing Windows policy assertion**

```bash
node --input-type=module -e "import { strict as assert } from 'node:assert'; import { resolvePetWindowPolicy } from './electron/window-policy.js'; assert.equal(resolvePetWindowPolicy('win32').focusable, false)"
```

Expected: FAIL because the existing result is `true`.

- [x] **Step 2: Add the platform regression test**

```js
it('makes the Windows pet non-focusable so changing focus cannot expose a title bar', () => {
  expect(resolvePetWindowPolicy('win32')).toEqual({ focusable: false });
});
```

- [x] **Step 3: Implement the minimal platform policy**

```js
export function resolvePetWindowPolicy(platform) {
  return {
    focusable: platform === 'darwin',
  };
}
```

- [ ] **Step 4: Run Electron tests**

```bash
npm run test:electron
```

Expected: all Electron tests pass.

### Task 2: Release metadata and verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: package version `0.2.3` and release tag `v0.2.3`

- [x] **Step 1: Bump package metadata**

Set the root package version in both package files to `0.2.3`.

- [ ] **Step 2: Run the complete desktop release gate**

```bash
npm run check:desktop-release
```

Expected: Electron, unit, type, build, E2E, packaging-resource, workflow, and release checks all pass.

- [ ] **Step 3: Commit and publish**

Commit the tested files, open and merge a pull request, tag the resulting
`main` commit as `v0.2.3`, and confirm that all five platform artifacts are
attached to the GitHub release.
