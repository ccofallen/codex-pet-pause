# Task 8 Report: Android Pet Import and Petdex

## Scope

- Plan: `docs/superpowers/plans/2026-08-08-android-floating-pet.md`
- Brief: `.superpowers/sdd/2026-08-08-android-floating-pet/task-8-brief.md`
- Base SHA: `cdad11ad31254f4e381753e3c0ec4ee9eed95e6d`
- Initial Task 8 implementation commit: `2a468ed`
- Scope remained limited to Task 8 source, tests, and this report.

## Implemented

- Android system document picker imports either one ZIP package or the original independent `pet.json` plus WebP workflow.
- Android-selected files are converted to canonical `File` objects and passed through the existing shared archive/import validators, retaining path traversal, nested-folder, encryption, archive-size, expanded-size, file-count, exact-asset, pixel, and integrity protections.
- Validated assets persist through the Task 2 immutable native asset transaction before activation.
- Petdex runs in a separate non-exported Android activity with no Capacitor plugin or native bridge. Navigation and downloads are HTTPS/origin/MIME/name/signature allowlisted and bounded.
- Compatible Petdex ZIP downloads are retained in private local cache, announced to the foreground app, consumed once, validated, and previewed immediately.
- Android preview requires explicit confirmation before persistence and activation; cancel and error paths are bilingual.
- Confirmed imports update native settings, active pet state, and the running overlay service atomically.
- Android Pet Library layout places Petdex above Import with matched touch-accessible widths.
- Existing desktop/Electron import, drag/drop, Petdex, save-only, pet-size, and sound behavior remains on its original code paths.

## Strict TDD evidence

### Baseline

`npm run test:run -- src/features/pets/domain/importPet.test.ts src/features/pets/domain/importPetArchive.test.ts src/features/pets/components/PetLibrary.test.tsx`

- 3 test files passed.
- 102 tests passed.

### Red

Focused tests were added before production implementation for:

- Android picker and pending Petdex archive bridge contracts.
- Immediate Android preview and explicit activation.
- Mobile button ordering, sizing, cancellation, and bilingual error paths.
- Shared archive validation reuse.
- Private bounded pending archive storage and one-shot consumption.
- Atomic native persistence, state activation, overlay refresh, and rollback.
- Dotted imported pet IDs across the web/native boundary.

The focused TypeScript run failed on missing APIs and Android behavior. The dotted-ID regression failed with `unsafe Android pet id`. Native tests were initially blocked before compilation because the Android SDK was unavailable; that gap was closed during final validation below.

### Green

`npm run test:run -- src/android/infrastructure/androidPetImport.test.ts src/android/bridge/androidHost.test.ts src/android/components/AndroidApp.test.tsx src/features/pets/domain/importPet.test.ts src/features/pets/domain/importPetArchive.test.ts src/features/pets/components/PetLibrary.test.tsx`

- 6 test files passed.
- 131 tests passed.

`npm run typecheck`

- Passed.

`npm run test:run`

- 64 test files passed.
- 774 tests passed.

`npm run test:electron`

- 3 test files passed.
- 10 tests passed.

`git diff --check` and `git diff --cached --check`

- Passed before the initial Task 8 commit.

## Native and Robolectric validation

Toolchain:

- `JAVA_HOME=/private/tmp/codex-jdk21`
- `ANDROID_HOME=/private/tmp/android-sdk`
- `ANDROID_SDK_ROOT=/private/tmp/android-sdk`
- `PATH=/private/tmp/codex-jdk21/bin:$PATH`

Every Gradle command had a hard timeout of at most five minutes. No command timed out or remained running.

### Focused Task 8 native tests

`./gradlew testDebugUnitTest --tests '*PendingPetArchiveStoreTest' --tests '*AndroidStateCoordinatorTest'`

- Passed with `BUILD SUCCESSFUL in 51s`.
- 66 actionable tasks: 32 executed, 34 up-to-date.
- Kotlin production and test sources compiled successfully.

### Complete native/Robolectric suite and compile fix

The first complete `./gradlew testDebugUnitTest` run compiled successfully and reported 100 tests with one failure:

- `AndroidHostPluginResumeTest.actualHandleOnResumeRefreshesCapabilitiesAndPublishesEvent`
- Root cause: Task 8's resume callback announced pending archives even when the existing isolated lifecycle test had intentionally installed only the resume boundary, before Capacitor `load()` initialized the archive store.
- Minimal fix: guard only pending-archive announcement until `pendingArchives` is initialized. Production still initializes the store in `load()` before announcing downloads.

`./gradlew testDebugUnitTest --tests '*AndroidHostPluginResumeTest'`

- Passed with `BUILD SUCCESSFUL in 3s`.

`./gradlew testDebugUnitTest`

- Passed with `BUILD SUCCESSFUL in 6s`.
- All 100 native/Robolectric tests passed.
- 66 actionable tasks: 1 executed, 65 up-to-date.

### Android debug build

The first `./gradlew assembleDebug` reached dexing and exposed stale generated Capacitor dependency intermediates containing duplicate `* 2.class` files. A narrow search confirmed the duplicates existed only under `node_modules/@capacitor/android/capacitor/build`, not dependency or Task 8 source.

`./gradlew clean assembleDebug`

- Passed with `BUILD SUCCESSFUL in 3s`.
- 99 actionable tasks: 90 executed, 9 up-to-date.
- Gradle's own `clean` tasks removed stale build intermediates; no Capacitor sync or regeneration was run.

## Remaining validation gap

- No emulator/device end-to-end interaction was run for the Android system picker, remote Petdex download, overlay refresh, or audible notification behavior. These flows are covered at unit/Robolectric and TypeScript integration boundaries, and the debug APK assembles successfully.
- Android compilation reports only deprecation warnings for existing WebView file-URL settings and back handling; there are no compile errors.

## Protected paths

- No progress ledger was modified.
- No `release/` content was modified.
- No `dist-android/` content was modified.
- No generated Gradle file was modified.
- Capacitor was not synced or regenerated.

## Review fixes

### Petdex request and process isolation

- Petdex remains a non-exported activity and now runs in the dedicated `:petdex` process, isolating its process-global WebView service-worker policy from the privileged main and overlay WebViews.
- Main-frame, iframe, image, fetch/XHR, redirect, and other WebView resource requests use one exact-origin request gate. The service-worker client uses the same gate.
- The only allowed remote origin is exactly `https://petdex.dev` on the default HTTPS port. No additional static origin was required. Non-HTTPS URLs, credentials, alternate ports, wildcard/suffix lookalikes, localhost, direct loopback/link-local/RFC1918 addresses, and file/content/data/blob URLs are rejected.
- Download redirects are checked at every hop and retain the exact origin, MIME, name, signature, timeout, and byte-limit checks.
- `WebSocket`, `WebSocketStream`, and `WebTransport` are replaced with immutable throwing constructors by an AndroidX document-start script before page scripts execute. If document-start injection is unsupported or fails, JavaScript remains disabled, so the remote page cannot fall back to arbitrary WebSocket or local-network JavaScript connections.
- Only one Petdex download can run at a time; additional download attempts are rejected rather than queued without bound.

### Pet path parity

- TypeScript asset-path validation now accepts the same dotted pet IDs as the shared importer and native state validator.
- Canonical path shape remains exactly `pets/<id>/<32-hex-revision>/spritesheet.webp`.
- Empty and dot segments, traversal, encoded separators, spaces, alternate filenames, and unsafe characters remain rejected by parity tests in TypeScript and Kotlin.

### Bounded pending storage and recoverable FIFO queue

- Pre-validation storage defaults to 32 MiB per archive, 64 MiB aggregate, at most four pending archives, and a 24-hour TTL.
- Store-wide synchronization makes file-count and aggregate quota checks atomic across concurrent store instances in the process.
- Startup and subsequent access remove expired archives, invalid private-directory entries, and interrupted `.tmp` files.
- Publication timestamps preserve FIFO order independently of random handoff tokens.
- Native reads are now non-destructive claims. Archives are deleted only after explicit `imported`, `cancelled`, or `rejected` completion; `retry` releases the claim without deletion.
- Native announces and permits only the FIFO head. The TypeScript adapter suppresses duplicates and does not deliver the next token until the active token completes.
- Process death or unsubscribe before preview releases or reconstructs the claim from the still-present archive. Validation errors, user cancellation, activation success, temporary claim errors, and acknowledgement failures have explicit outcomes.

### Activation and restore consistency

- Immutable asset/state commit remains the only save-failure boundary.
- Snapshot publication and live overlay refresh occur after commit. Their failures are logged as recoverable warnings and cannot reject an already committed activation.
- The native result exposes `refreshWarning`; the Android preview still closes and reports success after commit.
- Petdex saves WebView state and restores it on recreation. A non-null but empty/failed restore loads the initial production URL instead of leaving a blank surface.

## Review TDD and validation evidence

### Red

The first focused TypeScript run preserved 57 passing tests while six new review tests failed for the intended missing behavior:

- Dotted immutable asset paths were rejected by `overlayProtocol`.
- Native archive events were delivered concurrently and duplicated.
- No explicit cancel, reject, retry, or imported acknowledgement existed.

The first focused native run failed compilation only on the newly specified claim/ack, quota/TTL, queue, request-policy, restore-policy, and post-commit effect APIs.

### Focused green

`npm run test:run -- src/android/domain/overlayProtocol.task8Review.test.ts src/android/infrastructure/androidPetImport.test.ts src/android/bridge/androidHost.test.ts src/features/pets/components/PetLibrary.test.tsx`

- 4 test files passed.
- 72 tests passed.

`./gradlew testDebugUnitTest --tests '*PendingPetArchiveStoreTest' --tests '*PetdexActivitySecurityTest' --tests '*AndroidPetPathParityTest' --tests '*AndroidCommittedMutationEffectsTest'`

- Passed with `BUILD SUCCESSFUL in 31s`.
- Production and test Kotlin compiled successfully.

### Full bounded validation

All commands used the documented JDK/Android SDK environment and hard timeouts of at most five minutes. No command timed out or remained running.

`npm run typecheck`

- Passed.

`npm run test:run`

- 65 test files passed.
- 787 tests passed.

`npm run test:electron`

- 3 test files passed.
- 10 tests passed.

`./gradlew testDebugUnitTest`

- Passed with `BUILD SUCCESSFUL in 6s`.

`./gradlew assembleDebug`

- Passed with `BUILD SUCCESSFUL in 628ms`.
- 95 actionable tasks: 3 executed, 92 up-to-date.

No Capacitor sync/regeneration or generated web build was run. The existing device/emulator interaction gap remains unchanged.

## Remaining review findings resolved (2026-08-08)

- Removed the Petdex secondary process. Petdex remains a dedicated, non-exported Activity with a plain bridge-free WebView; no Capacitor bridge or JavaScript interface is attached.
- Expanded document-start hardening to immutable Worker, SharedWorker, ServiceWorker registration, WebSocket, WebSocketStream, WebTransport, RTCPeerConnection, webkitRTCPeerConnection, and EventSource blockers. JavaScript remains disabled when document-start injection is unavailable. The exact HTTPS Petdex request and lifecycle-scoped ServiceWorker allowlist remains in force.
- Changed pending archive acknowledgement to an atomic rename-to-tombstone transition. Physical deletion is best-effort and cleanup retries later, so deletion failure cannot block FIFO progression while tombstones remain inside aggregate quota accounting.
- Added one bounded transparent TypeScript acknowledgement retry and source-bound preview state. Android import controls are disabled while a Petdex claim is active, and manual previews cannot acknowledge Petdex tokens.
- Native mutations now return a strictly parsed committed snapshot plus the observable refresh warning. Android applies that snapshot directly without depending on event delivery.
- Added a same-process overlay state refresh bus for a running service and two bounded foreground-service command retries. A stopped service continues to read persisted state on its next start; exhausted retries remain logged as recoverable warnings.
- Existing dotted pet IDs continue through the shared/native/path grammar without traversal or separator relaxation.
- Desktop import controls and post-delete focus behavior remain unchanged.

## TDD and bounded validation evidence

RED evidence:
- Focused web regression run initially failed 6 targeted tests covering process isolation, FIFO acknowledgement retry, typed commit results, controller state application, source-bound previewing, and Android control serialization.
- Focused native regression compilation initially failed only for the newly specified retrier, refresh bus, and tombstone deletion seam.

GREEN evidence:
- `npm run test:run -- src/android/infrastructure/petdexIsolation.test.ts src/android/infrastructure/androidPetImport.test.ts src/android/bridge/androidHost.test.ts src/app/appController.externalState.test.ts src/features/pets/components/PetLibrary.test.tsx`: 5 files, 70 tests passed.
- `npm run test:run`: 67 files, 793 tests passed.
- `npm run typecheck`: passed.
- `./gradlew testDebugUnitTest --tests '*PetdexActivitySecurityTest' --tests '*PendingPetArchiveStoreTest' --tests '*AndroidCommittedMutationEffectsTest' --tests '*AndroidOverlayRefreshRetrierTest' --tests '*PetOverlayStateRefreshBusTest'`: BUILD SUCCESSFUL.
- `./gradlew testDebugUnitTest`: BUILD SUCCESSFUL.
- `./gradlew assembleDebug`: BUILD SUCCESSFUL.
- Native commands used the supplied JDK 21 and Android SDK environment and hard timeouts. No command timed out or hung.
- Capacitor sync/regeneration was not run.

## Gaps

- None found in the requested bounded automated validation.
