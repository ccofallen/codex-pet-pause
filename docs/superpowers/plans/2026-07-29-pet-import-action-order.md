# Pet Import Action Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the manual Codex pet import button below the Petdex button and keep both controls the same size.

**Architecture:** Keep both existing actions and handlers unchanged. Group the controls in one vertical CSS grid so their order and dimensions share a single layout contract.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- Petdex automatic import remains the first action.
- Manual Codex pet import remains available as the second action.
- Both action buttons use the same width and minimum height.
- Download validation and import processing behavior do not change.

---

### Task 1: Align Pet Import Actions

**Files:**
- Modify: `src/features/pets/components/PetLibrary.tsx`
- Modify: `src/styles/global.css`
- Test: `src/features/pets/components/PetLibrary.test.tsx`

**Interfaces:**
- Consumes: Existing `openPetdex` handler and `inputRef` file picker.
- Produces: `.pet-import-actions`, a vertical action group with Petdex first and manual import second.

- [ ] **Step 1: Write the failing test**

Assert that both action buttons have the same `.pet-import-actions` parent and that the Petdex button precedes the manual import button.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:run -- src/features/pets/components/PetLibrary.test.tsx`

Expected: FAIL because the buttons are not grouped and manual import currently appears first.

- [ ] **Step 3: Implement the action group**

Wrap both buttons and the Petdex hint in `.pet-import-actions`, move the Petdex button above the manual import button, and make direct button children fill the group width with the same minimum height.

- [ ] **Step 4: Run the focused test**

Run: `npm run test:run -- src/features/pets/components/PetLibrary.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run the desktop release gate**

Run: `npm run check:desktop-release`

Expected: All Electron, application, E2E, build, and packaged-resource checks pass.
