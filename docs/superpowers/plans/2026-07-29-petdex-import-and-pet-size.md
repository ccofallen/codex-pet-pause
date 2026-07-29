# Petdex Import and Pet Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship automatic Petdex ZIP handoff and persistent three-level pet sizing as desktop release 0.2.4.

**Architecture:** Electron owns the isolated remote browser and temporary download. The renderer reuses the existing ZIP preview pipeline. A schema-backed size preference feeds one shared viewport sizing function used by both pet renderers.

**Tech Stack:** Electron 35, React 19, TypeScript, Vitest, Playwright

## Global Constraints

- Medium must preserve the current desktop pet size.
- Petdex downloads must still require import-preview confirmation.
- Existing manual ZIP and loose-file imports remain available.
- Release version is `0.2.4`.

---

### Task 1: Petdex download bridge

**Files:**
- Create: `electron/petdex-download.js`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `src/types/electron-api.d.ts`
- Modify: `src/features/pets/components/PetLibrary.tsx`
- Test: `electron/petdex-download.test.js`
- Test: `electron/main.test.js`
- Test: `src/features/pets/components/PetLibrary.test.tsx`

- [x] Define and test the Petdex origin, ZIP, and size policies.
- [x] Add the sandboxed Petdex browser and temporary download bridge.
- [x] Feed intercepted archives into the existing preview flow.
- [ ] Run focused Electron and pet-library tests.

### Task 2: Persistent pet sizing

**Files:**
- Modify: `src/app/model.ts`
- Modify: `src/app/defaults.ts`
- Modify: `src/infrastructure/settingsRepository.ts`
- Modify: `src/features/cat/stage/viewport.ts`
- Modify: `src/features/cat/components/InteractiveCatStage.tsx`
- Modify: `src/features/pets/components/CodexPetStage.tsx`
- Modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/i18n/messages.ts`

- [x] Migrate settings schema 5 with medium as the fallback.
- [x] Add localized small, medium, and large controls.
- [x] Apply shared dimensions to both pet renderers and their interaction geometry.
- [ ] Run focused persistence, viewport, and settings tests.

### Task 3: Release

- [ ] Run `npm run check:desktop-release`.
- [ ] Commit, review, merge, tag `v0.2.4`, and verify all five release assets.
