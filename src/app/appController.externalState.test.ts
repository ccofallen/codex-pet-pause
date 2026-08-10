import { expect, test } from 'vitest';
import { createDefaultSettings } from './defaults';
import { createAppController } from './appController';
import { createFakeDependencies } from '../test/fakes';
import { MURK_TEST_PET } from '../test/petFixtures';

test('applies a returned committed native state directly to the visible app snapshot', async () => {
  const controller = createAppController(createFakeDependencies({ now: 10 }));
  await controller.hydrate();
  const settings = createDefaultSettings(10, 'en');
  settings.activePetId = MURK_TEST_PET.id;

  controller.applyCommittedState?.({ settings, pets: [MURK_TEST_PET] });

  expect(controller.getSnapshot()).toMatchObject({
    settings: { activePetId: MURK_TEST_PET.id },
    pets: [{ id: MURK_TEST_PET.id }],
    storageMode: 'persistent',
  });
});

test('rejects a delayed import snapshot older than the latest compact runtime revision', async () => {
  const controller = createAppController(createFakeDependencies({ now: 10 }));
  await controller.hydrate();
  const newest = createDefaultSettings(10, 'en');
  newest.affinity = 80;
  controller.applyCommittedRuntimeState({ revision: 12, settings: newest });
  const stale = createDefaultSettings(10, 'en');
  stale.activePetId = MURK_TEST_PET.id;

  controller.applyCommittedState?.({ revision: 11, settings: stale, pets: [MURK_TEST_PET] });

  expect(controller.getSnapshot().settings).toBe(newest);
  expect(controller.getSnapshot().pets).toEqual([]);
});

test('uses the Android repository atomic selection fallback without a second settings write', async () => {
  const settings = createDefaultSettings(10, 'en');
  settings.activePetId = MURK_TEST_PET.id;
  const deps = createFakeDependencies({ now: 10, settings });
  deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
  (deps.pets as typeof deps.pets & { selectionFallbackAtomic?: boolean }).selectionFallbackAtomic = true;
  const controller = createAppController(deps);
  await controller.hydrate();
  deps.settings.saves.length = 0;

  await controller.deletePet(MURK_TEST_PET.id);

  expect(deps.settings.saves).toEqual([]);
  expect(controller.getSnapshot().settings.activePetId).toBe('builtin-cat');
  expect(controller.getSnapshot().pets).toEqual([]);
});

test('applies only newer runtime revisions while restarting countdown and preserving pet identities', async () => {
  const deps = createFakeDependencies({ now: 10 });
  deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
  const controller = createAppController(deps);
  await controller.hydrate();
  const before = controller.getSnapshot();
  const pets = before.pets;
  const pet = pets[0];
  const spritesheet = pet && 'spritesheet' in pet ? pet.spritesheet : undefined;
  const committed = createDefaultSettings(10, 'en');
  committed.reminders = committed.reminders.map((reminder) => reminder.id === 'lookAway'
    ? { ...reminder, nextDueAt: 120_010 }
    : reminder);

  controller.applyCommittedRuntimeState({ revision: 2, settings: committed });

  const applied = controller.getSnapshot();
  expect(applied.scheduler.reminders.find(({ id }) => id === 'lookAway')?.nextDueAt)
    .toBe(120_010);
  expect(applied.historyRevision).toBe(1);
  expect(applied.pets).toBe(pets);
  expect(applied.pets[0]).toBe(pet);
  expect(applied.pets[0] && 'spritesheet' in applied.pets[0] ? applied.pets[0].spritesheet : undefined)
    .toBe(spritesheet);

  const stale = createDefaultSettings(10, 'en');
  stale.reminders = stale.reminders.map((reminder) => reminder.id === 'lookAway'
    ? { ...reminder, nextDueAt: 10 }
    : reminder);
  controller.applyCommittedRuntimeState({ revision: 1, settings: stale });

  expect(controller.getSnapshot()).toBe(applied);
});

test('a compact runtime revision wins when an older full hydration finishes later', async () => {
  const deps = createFakeDependencies({ now: 10 });
  let finishPetLoad!: (pets: []) => void;
  deps.pets.list = () => new Promise((resolve) => { finishPetLoad = resolve; });
  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await Promise.resolve();
  await Promise.resolve();
  const committed = createDefaultSettings(10, 'en');
  committed.reminders = committed.reminders.map((reminder) => reminder.id === 'lookAway'
    ? { ...reminder, nextDueAt: 180_010 }
    : reminder);

  controller.applyCommittedRuntimeState({ revision: 3, settings: committed });
  finishPetLoad([]);
  await hydration;

  expect(controller.getSnapshot().scheduler.reminders
    .find(({ id }) => id === 'lookAway')?.nextDueAt).toBe(180_010);
  expect(controller.getSnapshot().historyRevision).toBe(1);
});

test('stale missing-pet recovery does not persist settings after a runtime revision advances', async () => {
  const stale = createDefaultSettings(10, 'en');
  stale.activePetId = MURK_TEST_PET.id;
  const deps = createFakeDependencies({ now: 10, settings: stale });
  let finishPetLoad!: (pets: []) => void;
  deps.pets.list = () => new Promise((resolve) => { finishPetLoad = resolve; });
  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await Promise.resolve();
  await Promise.resolve();
  const committed = createDefaultSettings(10, 'en');
  committed.reminders = committed.reminders.map((reminder) => reminder.id === 'lookAway'
    ? { ...reminder, nextDueAt: 240_010 }
    : reminder);

  controller.applyCommittedRuntimeState({ revision: 4, settings: committed });
  finishPetLoad([]);
  await hydration;

  expect(deps.settings.saves).toEqual([]);
  expect(controller.getSnapshot().settings).toBe(committed);
});

test('protected hydration preserves the newer suppression observation timestamp', async () => {
  const hydrationStartedAt = new Date(2026, 6, 11, 7).getTime();
  const runtimeAppliedAt = new Date(2026, 6, 11, 8).getTime();
  const stale = createDefaultSettings(hydrationStartedAt, 'en');
  stale.quietHours = { enabled: true, startMinutes: 7 * 60, endMinutes: 8 * 60 };
  stale.reminders = stale.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: hydrationStartedAt + (index + 2) * 60 * 60_000,
  }));
  const deps = createFakeDependencies({ now: hydrationStartedAt, settings: stale });
  let finishPetLoad!: (pets: []) => void;
  deps.pets.list = () => new Promise((resolve) => { finishPetLoad = resolve; });
  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await Promise.resolve();
  await Promise.resolve();
  deps.clock.set(runtimeAppliedAt);
  const committed = structuredClone(stale);
  committed.runtime = {};
  committed.reminders = committed.reminders.map((reminder) => ({
    ...reminder,
    nextDueAt: reminder.nextDueAt + 60 * 60_000,
  }));
  const committedDueAt = committed.reminders[0]!.nextDueAt;

  controller.applyCommittedRuntimeState({ revision: 5, settings: committed });
  finishPetLoad([]);
  await hydration;
  await controller.saveSettings({ ...controller.getSnapshot().settings, theme: 'dark' });

  expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt).toBe(committedDueAt);
});

test('runtime state wins visibly and persistently when fallback save is already in flight', async () => {
  const hydrationStartedAt = new Date(2026, 6, 11, 7).getTime();
  const runtimeAppliedAt = new Date(2026, 6, 11, 8).getTime();
  const stale = createDefaultSettings(hydrationStartedAt, 'en');
  stale.activePetId = MURK_TEST_PET.id;
  stale.quietHours = { enabled: true, startMinutes: 7 * 60, endMinutes: 8 * 60 };
  stale.reminders = stale.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: hydrationStartedAt + (index + 2) * 60 * 60_000,
  }));
  const deps = createFakeDependencies({ now: hydrationStartedAt, settings: stale });
  let releaseFallbackSave!: () => void;
  let fallbackSaveStarted!: () => void;
  const fallbackStarted = new Promise<void>((resolve) => { fallbackSaveStarted = resolve; });
  const fallbackRelease = new Promise<void>((resolve) => { releaseFallbackSave = resolve; });
  const save = deps.settings.save.bind(deps.settings);
  let saves = 0;
  deps.settings.save = async (settings) => {
    saves += 1;
    if (saves === 1) {
      fallbackSaveStarted();
      await fallbackRelease;
    }
    await save(settings);
  };
  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await fallbackStarted;
  deps.clock.set(runtimeAppliedAt);
  const committed = structuredClone(stale);
  committed.activePetId = 'builtin-cat';
  committed.runtime = {};
  committed.reminders = committed.reminders.map((reminder) => ({
    ...reminder,
    nextDueAt: reminder.nextDueAt + 60 * 60_000,
  }));
  const committedDueAt = committed.reminders[0]!.nextDueAt;

  controller.applyCommittedRuntimeState({ revision: 6, settings: committed });
  releaseFallbackSave();
  await hydration;

  expect(controller.getSnapshot().settings).toBe(committed);
  expect(deps.settings.value).toEqual(committed);
  await controller.saveSettings({ ...controller.getSnapshot().settings, theme: 'dark' });
  expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt).toBe(committedDueAt);
});

test('runtime state applied before hydration remains authoritative over a stale full snapshot', async () => {
  const stale = createDefaultSettings(10, 'en');
  stale.activePetId = MURK_TEST_PET.id;
  const deps = createFakeDependencies({ now: 10, settings: stale });
  const controller = createAppController(deps);
  const committed = createDefaultSettings(20, 'en');
  committed.reminders = committed.reminders.map((reminder) => reminder.id === 'lookAway'
    ? { ...reminder, nextDueAt: 300_020 }
    : reminder);
  controller.applyCommittedRuntimeState({ revision: 7, settings: committed });

  await controller.hydrate();

  expect(controller.getSnapshot().settings).toBe(committed);
  expect(controller.getSnapshot().scheduler.reminders
    .find(({ id }) => id === 'lookAway')?.nextDueAt).toBe(300_020);
  expect(deps.settings.saves).toEqual([]);
});

test('failed imported asset hydration corrects only activePetId on runtime-authoritative settings', async () => {
  const now = new Date(2026, 6, 11, 9).getTime();
  const deps = createFakeDependencies({ now });
  deps.pets.list = async () => { throw new Error('invalid imported pet asset'); };
  const controller = createAppController(deps);
  const committed = createDefaultSettings(now, 'en');
  committed.activePetId = MURK_TEST_PET.id;
  committed.affinity = 37;
  committed.runtime = { pausedAt: now, pausedUntil: now + 30 * 60_000 };
  committed.reminders = committed.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: now + (index + 1) * 123_000,
  }));
  controller.applyCommittedRuntimeState({ revision: 8, settings: committed });

  await controller.hydrate();

  const corrected = controller.getSnapshot().settings;
  expect(corrected).toEqual({ ...committed, activePetId: 'builtin-cat' });
  expect(corrected.reminders).toEqual(committed.reminders);
  expect(corrected.runtime).toEqual(committed.runtime);
  expect(deps.settings.value).toEqual(corrected);
  expect(deps.settings.saves).toEqual([corrected]);
  expect(controller.getSnapshot().petLibraryError).toBe('load-failed');
});

test('newer valid imported selection survives stale hydration catalog correction', async () => {
  const now = new Date(2026, 6, 11, 10).getTime();
  const deps = createFakeDependencies({ now });
  let releaseCorrection!: () => void;
  let correctionStarted!: () => void;
  const started = new Promise<void>((resolve) => { correctionStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseCorrection = resolve; });
  const save = deps.settings.save.bind(deps.settings);
  let saves = 0;
  deps.settings.save = async (settings) => {
    saves += 1;
    if (saves === 1) {
      correctionStarted();
      await release;
    }
    await save(settings);
  };
  const controller = createAppController(deps);
  const missingSelection = createDefaultSettings(now, 'en');
  missingSelection.activePetId = 'missing-import';
  controller.applyCommittedRuntimeState({ revision: 8, settings: missingSelection });
  const hydration = controller.hydrate();
  await started;
  const importedSelection = createDefaultSettings(now, 'en');
  importedSelection.activePetId = MURK_TEST_PET.id;
  importedSelection.affinity = 48;
  importedSelection.runtime = { pausedAt: now, pausedUntil: now + 15 * 60_000 };
  importedSelection.reminders = importedSelection.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: now + (index + 1) * 321_000,
  }));

  controller.applyCommittedState?.({ settings: importedSelection, pets: [MURK_TEST_PET] });
  controller.applyCommittedRuntimeState({ revision: 9, settings: importedSelection });
  releaseCorrection();
  await hydration;

  expect(controller.getSnapshot().settings).toBe(importedSelection);
  expect(controller.getSnapshot().pets).toEqual([MURK_TEST_PET]);
  expect(deps.settings.value).toEqual(importedSelection);
  expect(deps.settings.saves.at(-1)).toEqual(importedSelection);
});

test('missing-pet fallback re-evaluates a catalog repaired by savePet', async () => {
  const now = new Date(2026, 6, 11, 10).getTime();
  const deps = createFakeDependencies({ now });
  const missingSelection = createDefaultSettings(now, 'en');
  missingSelection.activePetId = MURK_TEST_PET.id;
  deps.settings.value = missingSelection;

  let releaseFallback!: () => void;
  let fallbackStarted!: () => void;
  const started = new Promise<void>((resolve) => { fallbackStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseFallback = resolve; });
  const save = deps.settings.save.bind(deps.settings);
  let saves = 0;
  deps.settings.save = async (settings) => {
    saves += 1;
    if (saves === 1) {
      fallbackStarted();
      await release;
    }
    await save(settings);
  };

  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await started;

  const settingsBeforeRepair = controller.getSnapshot().settings;
  await controller.savePet(MURK_TEST_PET);
  expect(controller.getSnapshot().settings).toBe(settingsBeforeRepair);

  releaseFallback();
  await hydration;

  expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
  expect(controller.getSnapshot().pets).toEqual([MURK_TEST_PET]);
  expect(deps.settings.value.activePetId).toBe(MURK_TEST_PET.id);
  expect(deps.settings.saves.at(-1)?.activePetId).toBe(MURK_TEST_PET.id);
});

test('rejected missing-pet fallback re-evaluates a catalog repaired by savePet', async () => {
  const now = new Date(2026, 6, 11, 10).getTime();
  const deps = createFakeDependencies({ now });
  const missingSelection = createDefaultSettings(now, 'en');
  missingSelection.activePetId = MURK_TEST_PET.id;
  deps.settings.value = missingSelection;

  let releaseFallback!: () => void;
  let fallbackStarted!: () => void;
  const started = new Promise<void>((resolve) => { fallbackStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseFallback = resolve; });
  const save = deps.settings.save.bind(deps.settings);
  let saves = 0;
  deps.settings.save = async (settings) => {
    saves += 1;
    if (saves === 1) {
      fallbackStarted();
      await release;
      throw new Error('stale fallback write rejected');
    }
    await save(settings);
  };

  const controller = createAppController(deps);
  const hydration = controller.hydrate();
  await started;

  const settingsBeforeRepair = controller.getSnapshot().settings;
  await controller.savePet(MURK_TEST_PET);
  expect(controller.getSnapshot().settings).toBe(settingsBeforeRepair);

  releaseFallback();
  await hydration;

  expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
  expect(controller.getSnapshot().pets).toEqual([MURK_TEST_PET]);
  expect(controller.getSnapshot().storageMode).toBe('persistent');
  expect(controller.getSnapshot().nonBlockingError).toBeUndefined();
  expect(deps.settings.value.activePetId).toBe(MURK_TEST_PET.id);
  expect(deps.settings.saves.at(-1)?.activePetId).toBe(MURK_TEST_PET.id);
});
