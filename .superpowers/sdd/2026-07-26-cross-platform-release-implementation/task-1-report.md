# Task 1 Report: Establish the Release Contract

## Result

Implemented the desktop release-config validator, its behavioral tests, and the two requested npm scripts. The final package matrix was not added; that remains owned by Task 3.

## TDD evidence

### RED

Command:

```bash
node --test scripts/verify-desktop-release-config.test.mjs
```

Output:

```text
TAP version 13
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/scripts/verify-desktop-release-config.mjs' imported from /Users/cc/Documents/Codex/codex-pet-pause-desktop/.worktrees/cross-platform-release/scripts/verify-desktop-release-config.test.mjs
# Subtest: scripts/verify-desktop-release-config.test.mjs
not ok 1 - scripts/verify-desktop-release-config.test.mjs
1..1
# tests 1
# pass 0
# fail 1
```

The test failed because the contract module did not exist, as required for the RED step.

### GREEN

Command:

```bash
npm run test:desktop-release-config
```

Output:

```text
> codex-pet-pause@0.2.0 test:desktop-release-config
> node --test scripts/verify-desktop-release-config.test.mjs

TAP version 13
# Subtest: accepts the approved desktop release contract
ok 1 - accepts the approved desktop release contract
# Subtest: rejects an identity, target, or icon regression
ok 2 - rejects an identity, target, or icon regression
1..2
# tests 2
# pass 2
# fail 0
```

## Files

- `scripts/verify-desktop-release-config.mjs`: Exports `verifyDesktopReleaseConfig(packageJson, fileExists)`, validates the approved identity, platform targets, and icon existence, and provides the standalone `check:desktop-release-config` entry point.
- `scripts/verify-desktop-release-config.test.mjs`: Covers acceptance of the approved contract and rejection of identity, target, and icon regressions.
- `package.json`: Adds `test:desktop-release-config` and `check:desktop-release-config`.

## Self-review

- The implementation follows the exact validator shape and values from the task brief.
- The injected `fileExists` function keeps the validator deterministic and directly testable.
- Missing target entries and missing architecture entries produce human-readable failures rather than throwing.
- No final Electron Builder package matrix or generated icon assets were added.

## Concerns

- `check:desktop-release-config` is expected to fail in this task state because `package.json` does not yet contain the final macOS, Windows, and Linux target configuration and the required icon assets are not present. Those changes belong to later release tasks.
- Artifact-name templates are present in the behavioral fixture but are not validated by the prescribed validator implementation.

## Fix round 1 evidence

### RED mutations

Added mutations for wrong configured native icon paths with `fileExists` returning `true`, plus extra `zip`, `nsis-web`, and `snap` targets. Before the validator changes:

```bash
node --test scripts/verify-desktop-release-config.test.mjs
```

```text
TAP version 13
# Subtest: accepts the approved desktop release contract
ok 1 - accepts the approved desktop release contract
# Subtest: rejects an identity, target, or icon regression
ok 2 - rejects an identity, target, or icon regression
# Subtest: rejects wrong configured native icon paths even when expected files exist
not ok 3 - rejects wrong configured native icon paths even when expected files exist
# Subtest: rejects unintended extra target formats on every platform
not ok 4 - rejects unintended extra target formats on every platform
1..4
# tests 4
# pass 2
# fail 2
```

### GREEN focused test

```bash
npm run test:desktop-release-config
```

```text
TAP version 13
# Subtest: accepts the approved desktop release contract
ok 1 - accepts the approved desktop release contract
# Subtest: rejects an identity, target, or icon regression
ok 2 - rejects an identity, target, or icon regression
# Subtest: rejects wrong configured native icon paths even when expected files exist
ok 3 - rejects wrong configured native icon paths even when expected files exist
# Subtest: rejects unintended extra target formats on every platform
ok 4 - rejects unintended extra target formats on every platform
1..4
# tests 4
# pass 4
# fail 0
```

### Direct check

```bash
npm run check:desktop-release-config
```

Expected current-package failure (exit code 1):

```text
Error: macOS targets must be exactly dmg
macOS DMG must target arm64 and x64
Windows targets must be exactly nsis
Windows NSIS must target x64
Linux targets must be exactly AppImage and deb
Linux AppImage must target x64
Linux DEB must target x64
macOS icon must be configured as build/icons/icon.icns
macOS icon is missing: build/icons/icon.icns
Windows icon must be configured as build/icons/icon.ico
Windows icon is missing: build/icons/icon.ico
Linux icon must be configured as build/icons/png
Linux icon is missing: build/icons/png
```

## Fix round 1 changes

- Native icon validation now compares each configured platform icon with its expected native path before checking file existence.
- Target validation now rejects any platform target-name set other than macOS `dmg`, Windows `nsis`, and Linux `AppImage` plus `deb`, while retaining the required architecture checks.
