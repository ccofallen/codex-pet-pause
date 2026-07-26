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
