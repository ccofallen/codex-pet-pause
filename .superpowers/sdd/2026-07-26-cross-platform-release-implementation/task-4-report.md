# Task 4: Build and Publish One GitHub Release Report

## Status

Implemented native matrix packaging and one idempotent GitHub tag release.

## RED Evidence

`node --test scripts/verify-desktop-workflow.test.mjs` initially failed because the `yaml` parser dependency was absent. After adding that prerequisite, the unchanged test failed with `ERR_MODULE_NOT_FOUND` for `scripts/verify-desktop-workflow.mjs`, proving the workflow validator had not been implemented.

## GREEN Evidence

`npm run test:desktop-workflow` passed: 5 tests, 0 failures. The tests parse the checked-in workflow and exercise an in-memory valid workflow plus mutations that break v* tag triggering, a native matrix entry, and the release dependency.

`npm run check:desktop-workflow` passed and printed `Desktop release workflow is valid.`

## Files

- `.github/workflows/build-desktop.yml`: validation, four-platform native packaging matrix, artifact upload, and one tag-only release job.
- `scripts/verify-desktop-workflow.mjs`: YAML-object workflow contract validator and direct-check entry point.
- `scripts/verify-desktop-workflow.test.mjs`: real-workflow and in-memory behavioral contract tests.
- `package.json`: workflow checks and platform-specific package aliases.
- `package-lock.json`: locks the direct `yaml` development dependency.

## Self-Review

- Pushes to `main`, `v*` tags, pull requests, and manual dispatches all trigger the workflow.
- The matrix produces macOS arm64 and x64 DMGs, a Windows x64 installer, and Linux x64 AppImage and DEB assets.
- Package jobs depend on validation and upload only the declared public artifact paths with missing files treated as errors.
- The release job waits for the full matrix, runs only for `refs/tags/v*`, merges all artifact downloads, and uses `gh release view` to upload to an existing release or create exactly one release when absent.
- Matrix commands call npm scripts and therefore remain compatible with the default Windows PowerShell runner shell; no Bash-only package command is used on Windows.

## Concerns

- Hosted GitHub Actions execution, including the Actionlint container and native installers, was not run locally; the semantic validator covers the release model before CI.
- `npm install` reported 32 dependency audit findings already present in the dependency tree (1 moderate, 30 high, 1 critical); this task added only `yaml` for workflow parsing.

## Fix Round 1 Evidence

### RED

The strengthened `node --test scripts/verify-desktop-workflow.test.mjs` suite failed as expected against the initial implementation: 3 passed and 5 failed. The failures demonstrated that the validator did not enforce the actionlint invocation, tag-push-only package and release conditions, matrix command presence, package `npm ci`, or protected artifact upload settings.

### GREEN

`npm run test:desktop-workflow` passed: 8 tests, 0 failures. The parsed-YAML fixtures now model validation, native packaging, and the idempotent release behavior, then mutate actionlint arguments, execution conditions, matrix commands, package setup, and artifact upload settings.

`npm run check:desktop-workflow` passed and printed `Desktop release workflow is valid.`

### Fix Review

- Actionlint now uses the pinned `rhysd/actionlint:1.7.12` image and supplies only the checked-in workflow path to the image entrypoint.
- Package and release jobs both require a push event and a `refs/tags/v*` ref, leaving main, pull request, and manual events to run validation only.
- The semantic validator rejects missing package commands, package setup, matrix artifact interpolation, and `if-no-files-found: error`, while retaining the exact installer matrix and existing release idempotency.
