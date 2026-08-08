# Task 8 Report: Android Local and Petdex Pet Imports

## Scope

Implemented Task 8 from `docs/superpowers/plans/2026-08-08-android-floating-pet.md` at base SHA `cdad11ad31254f4e381753e3c0ec4ee9eed95e6d`.

No files under `release/`, `dist-android/`, generated Gradle output, or the progress ledger were changed or staged.

## Implementation

- Added Android system document-picker support for one ZIP or the original independent `pet.json` plus WebP selection.
- Routed every selected file through the existing TypeScript ZIP and manifest/atlas validators, preserving archive traversal, encryption, entry-count, expanded-size, pixel, and integrity checks.
- Added a bounded private pending-archive store with one-shot consumption, ZIP signature checks, safe opaque tokens, and cleanup on oversize, invalid, or consumed downloads.
- Added a non-exported Petdex Activity in a separate task and WebView surface. It has no Capacitor/native bridge, no file/content access, no mixed content, and no cross-origin or non-HTTPS navigation.
- Restricted Petdex navigation and downloads to the exact `https://petdex.dev` origin. Downloads require an allowlisted ZIP MIME, a safe `.zip` name, a ZIP signature, and the shared archive validator.
- Retained Petdex archive-ready events until the main Android surface resumes, then opened the security preview without requiring the user to close Petdex manually.
- Added explicit Android preview confirmation. Confirmation invokes one native immutable save-and-activate transaction, updates settings and overlay state, emits `stateChanged`, and refreshes the live overlay service.
- Preserved the built-in cat/system-sound split already implemented by the native reminder notification channels.
- Added full-width, touch-accessible Android Petdex and import actions in the requested order while preserving desktop hidden-input, drag/drop, and Electron Petdex behavior.
- Kept small, medium, and large pet-size behavior unchanged, including the existing medium default.
- Aligned Android pet IDs with the existing shared validator so compatible dotted IDs are not rejected at the native boundary.
- Added bilingual Android security-preview copy and native Petdex cancellation/error feedback.

## TDD Evidence

Baseline:

- `npm run test:run -- src/features/pets/domain/importPet.test.ts src/features/pets/domain/importPetArchive.test.ts src/features/pets/components/PetLibrary.test.tsx`
- Result: 102 tests passed.

RED:

- Focused TypeScript Task 8 tests failed on missing adapter/host APIs, missing retained handoff, desktop controls rendered on Android, missing native picker flow, missing explicit activation, and missing localized errors.
- Dotted-ID host regression failed with `unsafe Android pet id` before the validator alignment.
- Native tests were written before native source. Native RED execution could not reach compilation because the machine has no Android SDK.

GREEN:

- Focused Task 8 and shared security suite: 6 files, 131 tests passed.
- `npm run typecheck`: passed.
- `npm run test:run`: 64 files, 774 tests passed.
- `npm run test:electron`: 3 files, 10 tests passed.

## Native Verification Gap

A temporary Eclipse Temurin JDK 21 was used from `/tmp`; it did not modify the repository or host installation.

Both the focused native test command and `./gradlew assembleDebug` stopped before compilation because no Android SDK is installed and neither `ANDROID_HOME` nor `android/local.properties` provides an SDK path. The bounded build attempt failed in 579 ms with `SDK location not found`.

Consequently, the Kotlin unit tests, Kotlin/Android compilation, APK build, and device-level Petdex/picker flow remain unverified in this environment. No retry loop, SDK installation, Gradle sync, or `dist-android/` generation was performed.

## Native Tests Added

- Bounded oversized download cleanup.
- One-shot pending archive consumption and deletion.
- Invalid ZIP and unsafe token rejection.
- Exact HTTPS Petdex origin and ZIP MIME/name allowlisting.
- Atomic immutable save plus active settings/overlay update.
- Failed native activation preserves the previous active state.
