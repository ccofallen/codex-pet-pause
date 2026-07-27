# Task 3 Report: Configure Native Packages and Preserve Desktop Identity

## Status

Completed the native Electron Builder configuration and runtime native icon lookup. No GitHub Actions files were modified.

## Files Changed

- `package.json`
  - Added macOS arm64/x64 DMG, Windows x64 NSIS, and Linux x64 AppImage/DEB targets.
  - Configured native icons and deterministic platform artifact names.
  - Added `build/**/*` to packaged files and changed `buildResources` to `build/icons`.
- `electron/main.js`
  - Resolves `build/icons/png/512x512.png` before the existing public PWA icon fallbacks.
- `scripts/verify-desktop-release-config.mjs`
  - Enforces the approved macOS, Windows, and Linux artifact-name patterns.
- `scripts/verify-desktop-release-config.test.mjs`
  - Asserts the approved artifact names and verifies alternate names are rejected.

## Test Evidence

### RED

Ran `npm run test:desktop-release-config` after adding the artifact-name regression test and before validator implementation.

- Result: 4 passed, 1 failed.
- Expected failure: `rejects artifact names that differ from the release contract` failed because no `macOS artifact name` failure was produced.

Ran `npm run check:desktop-release-config` before package configuration.

- Result: failed as expected.
- Reported missing platform targets and native icon configuration for macOS, Windows, and Linux.

### GREEN

Ran:

```bash
npm run test:desktop-release-config && npm run check:desktop-release-config && npm run build
```

- `test:desktop-release-config`: 5 passed, 0 failed.
- `check:desktop-release-config`: printed `Desktop release configuration is valid.`
- `build`: `tsc -b && vite build` succeeded; Vite transformed 106 modules and generated the PWA service-worker assets.

## Self-Review

- Preserved `appId` as `io.elevenlabs.codexpetpause` and `productName` as `Codex Pet Pause`.
- Preserved Windows `app.setAppUserModelId('io.elevenlabs.codexpetpause')`.
- Preserved the guarded `setVisibleOnAllWorkspaces` call.
- Preserved `userData`-based local state handling and its `pet-dock-state.json` identity.
- Removed no runtime PWA fallback paths; the generated native 512px icon is now first.
- The Windows target list contains NSIS only; no portable target was added.

## Concerns

- This task validates the release contract and frontend production bundle only. It does not produce platform installers on this host.
- GitHub Actions were intentionally left unchanged, per task scope.

## Fix Round 1: Exact Architectures and Unique Target Entries

### RED

Ran:

```bash
npm run test:desktop-release-config
```

- Result: 5 passed, 2 failed.
- `rejects unsupported or duplicate target architectures` failed because the validator accepted extra and duplicate architectures.
- `rejects duplicate expected target definitions` failed because the map-based target lookup collapsed duplicate entries.

### GREEN

Ran:

```bash
npm run test:desktop-release-config && npm run check:desktop-release-config
```

- `test:desktop-release-config`: 7 passed, 0 failed.
- `check:desktop-release-config`: printed `Desktop release configuration is valid.`
- The validator now requires exactly one expected target entry per platform target and exact, order-insensitive, duplicate-free architecture lists.

## Fix Round 2: Order-Independent Target Regression

### RED: Intentional Order-Sensitive Mutation

```text
$ node --test --test-name-pattern='accepts approved target and architecture entries in any order' scripts/verify-desktop-release-config.test.mjs
```
TAP version 13
# Subtest: accepts approved target and architecture entries in any order
not ok 1 - accepts approved target and architecture entries in any order
  ---
  duration_ms: 0.878167
  type: 'test'
  location: '/Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/scripts/verify-desktop-release-config.test.mjs:114:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
    
    + [
    +   'macOS DMG must target exactly arm64 and x64'
    + ]
    - []
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual:
    0: 'macOS DMG must target exactly arm64 and x64'
  operator: 'deepStrictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/scripts/verify-desktop-release-config.test.mjs:119:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 33.729375

### GREEN: Focused Regression Suite

```text
$ npm run test:desktop-release-config
```

> codex-pet-pause@0.2.0 test:desktop-release-config
> node --test scripts/verify-desktop-release-config.test.mjs

TAP version 13
# Subtest: accepts the approved desktop release contract
ok 1 - accepts the approved desktop release contract
  ---
  duration_ms: 0.85775
  type: 'test'
  ...
# Subtest: rejects an identity, target, or icon regression
ok 2 - rejects an identity, target, or icon regression
  ---
  duration_ms: 0.116458
  type: 'test'
  ...
# Subtest: rejects wrong configured native icon paths even when expected files exist
ok 3 - rejects wrong configured native icon paths even when expected files exist
  ---
  duration_ms: 0.1085
  type: 'test'
  ...
# Subtest: rejects artifact names that differ from the release contract
ok 4 - rejects artifact names that differ from the release contract
  ---
  duration_ms: 0.139208
  type: 'test'
  ...
# Subtest: rejects unintended extra target formats on every platform
ok 5 - rejects unintended extra target formats on every platform
  ---
  duration_ms: 0.074583
  type: 'test'
  ...
# Subtest: rejects unsupported or duplicate target architectures
ok 6 - rejects unsupported or duplicate target architectures
  ---
  duration_ms: 0.1045
  type: 'test'
  ...
# Subtest: rejects duplicate expected target definitions
ok 7 - rejects duplicate expected target definitions
  ---
  duration_ms: 0.054625
  type: 'test'
  ...
# Subtest: accepts approved target and architecture entries in any order
ok 8 - accepts approved target and architecture entries in any order
  ---
  duration_ms: 0.046083
  type: 'test'
  ...
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 32.608333

```text
$ npm run check:desktop-release-config
```

> codex-pet-pause@0.2.0 check:desktop-release-config
> node scripts/verify-desktop-release-config.mjs

Desktop release configuration is valid.
