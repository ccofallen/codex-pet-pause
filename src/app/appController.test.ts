import { describe, expect, test, vi } from 'vitest';
import { createDefaultSettings } from './defaults';
import type { AppSettings, AppSnapshot } from './model';
import {
  createAppController,
  getNextSchedulerWakeAt,
  isCurrentQuietRuntime,
  isQuietAt,
} from './appController';
import type { SchedulerState } from '../features/reminders/domain/types';
import { createCustomReminder } from '../features/reminders/domain/scheduler';
import { BUILTIN_PET_ID } from '../features/pets/domain/types';
import { createFakeDependencies } from '../test/fakes';
import { MURK_TEST_PET } from '../test/petFixtures';

const NOW = new Date(2026, 6, 11, 9).getTime();

function enabledSettings(now: number): AppSettings {
  const settings = createDefaultSettings(now);
  return {
    ...settings,
    soundEnabled: true,
    reminders: settings.reminders.map((reminder) => ({
      ...reminder,
      enabled: reminder.id === 'lookAway' || reminder.id === 'drinkWater',
      status: reminder.id === 'lookAway' || reminder.id === 'drinkWater' ? 'scheduled' : 'disabled',
    })),
  };
}

function snapshotFrom(
  settings: AppSettings,
  schedulerOverrides: Partial<SchedulerState> = {},
): AppSnapshot {
  return {
    ready: true,
    settings,
    scheduler: {
      reminders: settings.reminders,
      dueQueue: [],
      ...schedulerOverrides,
    },
    storageMode: 'persistent',
    notificationStatus: 'default',
    pets: [],
  };
}

describe('application controller', () => {
  test('uses its injected locale for initial, empty-storage, and reset settings', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: null, defaultLocale: 'en' });
    const controller = createAppController(deps);

    expect(controller.getSnapshot().settings.locale).toBe('en');
    await controller.hydrate();
    expect(controller.getSnapshot().settings.locale).toBe('en');
    await controller.clearAll();
    expect(controller.getSnapshot().settings.locale).toBe('en');
  });

  test('returns the earliest unqueued reminder wake and ignores queued occurrences', () => {
    const settings = enabledSettings(NOW);
    settings.reminders[0] = { ...settings.reminders[0]!, nextDueAt: NOW + 5_000 };
    settings.reminders[1] = { ...settings.reminders[1]!, nextDueAt: NOW + 10_000 };
    const snapshot = snapshotFrom(settings, {
      dueQueue: [{ reminderId: 'lookAway', dueAt: NOW + 5_000 }],
    });

    expect(getNextSchedulerWakeAt(snapshot, NOW)).toBe(NOW + 10_000);
  });

  test('wakes at the earliest active suppression boundary', () => {
    const settings = enabledSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    const snapshot = snapshotFrom(settings, {
      pausedAt: NOW,
      pausedUntil: NOW + 20 * 60_000,
      quietStartedAt: NOW,
    });

    expect(getNextSchedulerWakeAt(snapshot, NOW)).toBe(NOW + 20 * 60_000);
  });

  test('returns now for stale suppression runtime and undefined without actionable reminders', () => {
    const settings = createDefaultSettings(NOW);
    const stale = snapshotFrom(settings, { quietStartedAt: NOW - 24 * 60 * 60_000 });
    expect(getNextSchedulerWakeAt(stale, NOW)).toBe(NOW);
    expect(getNextSchedulerWakeAt(snapshotFrom(settings), NOW)).toBeUndefined();
  });

  test('starts newly enabled reminders from delayed onboarding completion time', async () => {
    const startedAt = NOW;
    const submittedAt = startedAt + 20 * 60_000;
    const deps = createFakeDependencies({ now: startedAt, settings: createDefaultSettings(startedAt) });
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.clock.set(submittedAt);
    const draft = controller.getSnapshot().settings;

    await controller.saveSettings({
      ...draft,
      onboardingComplete: true,
      reminders: draft.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' }
        : reminder),
    });

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'lookAway'))
      .toMatchObject({ status: 'scheduled', nextDueAt: submittedAt + 20 * 60_000 });
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
  });

  test('starts onboarding reminder time after an already-active pause ends', async () => {
    const startedAt = new Date(2026, 6, 11, 7).getTime();
    const submittedAt = new Date(2026, 6, 11, 7, 30).getTime();
    const suppressionEndsAt = new Date(2026, 6, 11, 8).getTime();
    const deps = createFakeDependencies({ now: startedAt, settings: createDefaultSettings(startedAt) });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(60);
    deps.clock.set(submittedAt);
    const draft = controller.getSnapshot().settings;

    await controller.saveSettings({
      ...draft,
      onboardingComplete: true,
      reminders: draft.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' }
        : reminder),
    });
    deps.clock.set(suppressionEndsAt);
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'lookAway')?.nextDueAt)
      .toBe(suppressionEndsAt + 20 * 60_000);
  });

  test('starts onboarding reminder time after an already-active quiet window ends', async () => {
    const startedAt = new Date(2026, 6, 11, 7).getTime();
    const submittedAt = new Date(2026, 6, 11, 7, 30).getTime();
    const suppressionEndsAt = new Date(2026, 6, 11, 8).getTime();
    const settings = createDefaultSettings(startedAt);
    settings.quietHours = { enabled: true, startMinutes: 7 * 60, endMinutes: 8 * 60 };
    const deps = createFakeDependencies({ now: startedAt, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    deps.clock.set(submittedAt);
    const draft = controller.getSnapshot().settings;

    await controller.saveSettings({
      ...draft,
      onboardingComplete: true,
      reminders: draft.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' }
        : reminder),
    });
    deps.clock.set(suppressionEndsAt);
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'lookAway')?.nextDueAt)
      .toBe(suppressionEndsAt + 20 * 60_000);
  });

  test('starts onboarding reminder time after a quiet window enabled on submission ends', async () => {
    const startedAt = new Date(2026, 6, 11, 7).getTime();
    const submittedAt = new Date(2026, 6, 11, 7, 30).getTime();
    const suppressionEndsAt = new Date(2026, 6, 11, 8).getTime();
    const deps = createFakeDependencies({ now: startedAt, settings: createDefaultSettings(startedAt) });
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.clock.set(submittedAt);
    const draft = controller.getSnapshot().settings;

    await controller.saveSettings({
      ...draft,
      onboardingComplete: true,
      quietHours: { enabled: true, startMinutes: 7 * 60, endMinutes: 8 * 60 },
      reminders: draft.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' }
        : reminder),
    });
    deps.clock.set(suppressionEndsAt);
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'lookAway')?.nextDueAt)
      .toBe(suppressionEndsAt + 20 * 60_000);
  });

  test('ignores future pause and stale quiet anchors when completing onboarding', async () => {
    const submittedAt = new Date(2026, 6, 11, 9).getTime();
    const settings = createDefaultSettings(submittedAt);
    settings.runtime = {
      pausedAt: submittedAt + 10 * 60_000,
      pausedUntil: submittedAt + 30 * 60_000,
      quietStartedAt: submittedAt - 24 * 60 * 60_000,
    };
    const deps = createFakeDependencies({ now: submittedAt, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    const draft = controller.getSnapshot().settings;

    await controller.saveSettings({
      ...draft,
      onboardingComplete: true,
      reminders: draft.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' }
        : reminder),
    });

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'lookAway')?.nextDueAt)
      .toBe(submittedAt + 20 * 60_000);
  });

  test.each([
    ['lookAway', 'lookAway'],
    ['drinkWater', 'drink'],
    ['standUp', 'stretch'],
    ['takeBreak', 'celebrate'],
  ] as const)('completion of %s adds one affinity point and emits %s intent', async (id, intent) => {
    const settings = createDefaultSettings(NOW);
    settings.affinity = 99;
    settings.reminders = settings.reminders.map((reminder) => ({
      ...reminder,
      enabled: true,
      status: 'scheduled',
    }));
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.complete(id);

    expect(controller.getSnapshot().settings.affinity).toBe(100);
    expect(controller.getSnapshot().catIntent).toBe(intent);
    expect(deps.history.events).toHaveLength(1);
    expect(deps.settings.saves).toHaveLength(1);
  });

  test('records a custom completion without requesting a preset cat intent', async () => {
    const deps = createFakeDependencies({ now: NOW });
    const custom = createCustomReminder('custom-medicine', '吃药', 30, NOW - 30 * 60_000, true);
    deps.settings.value = { ...deps.settings.value!, reminders: [...deps.settings.value!.reminders, custom] };
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    await controller.complete(custom.id);

    expect(deps.history.events[0]).toMatchObject({ reminderId: custom.id, reminderLabel: '吃药', action: 'completed' });
    expect(controller.getSnapshot().catIntent).toBeUndefined();
  });

  test('plays cat audio only for the built-in pet while always notifying', async () => {
    const builtIn = createFakeDependencies({ now: NOW });
    builtIn.settings.value!.reminders[0] = { ...builtIn.settings.value!.reminders[0]!, enabled: true, status: 'scheduled', nextDueAt: NOW };
    builtIn.settings.value!.soundEnabled = true;
    const builtInController = createAppController(builtIn);
    await builtInController.hydrate();
    await builtInController.reconcileNow();
    expect(builtIn.audio.plays).toBe(1);
    expect(builtIn.notifications.deliveries).toHaveLength(1);

    const imported = createFakeDependencies({ now: NOW });
    imported.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    imported.settings.value = structuredClone(builtIn.settings.value);
    imported.settings.value!.activePetId = MURK_TEST_PET.id;
    const importedController = createAppController(imported);
    await importedController.hydrate();
    await importedController.reconcileNow();
    expect(imported.audio.plays).toBe(0);
    expect(imported.notifications.deliveries).toHaveLength(1);
  });

  test('snooze and skip leave affinity and cat intent unchanged', async () => {
    const settings = enabledSettings(NOW);
    settings.affinity = 12;
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.complete('lookAway');
    expect(controller.getSnapshot()).toMatchObject({ settings: { affinity: 13 }, catIntent: 'lookAway' });
    await controller.snooze('drinkWater', 10);
    expect(controller.getSnapshot()).toMatchObject({ settings: { affinity: 13 }, catIntent: 'lookAway' });
    await controller.skip('drinkWater');
    expect(controller.getSnapshot()).toMatchObject({ settings: { affinity: 13 }, catIntent: 'lookAway' });
  });

  test('uses the persisted completion event id as a unique cat intent identity', async () => {
    const settings = enabledSettings(NOW);
    settings.affinity = 100;
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.complete('lookAway');
    const firstId = controller.getSnapshot().catIntentEventId;
    expect(firstId).toBe(deps.history.events.at(-1)?.id);

    await controller.complete('lookAway');
    const secondId = controller.getSnapshot().catIntentEventId;
    expect(secondId).toBe(deps.history.events.at(-1)?.id);
    expect(secondId).not.toBe(firstId);
    expect(deps.history.events).toHaveLength(2);

    await controller.snooze('drinkWater', 10);
    expect(controller.getSnapshot().catIntentEventId).toBe(secondId);
    await controller.skip('drinkWater');
    expect(controller.getSnapshot().catIntentEventId).toBe(secondId);
  });

  test('delivers localized preset and custom reminder payloads while preserving built-in audio', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    deps.settings.value = {
      ...deps.settings.value!,
      locale: 'en',
      reminders: [
        ...deps.settings.value!.reminders,
        createCustomReminder('custom-medicine', '服药', 45, NOW, true),
      ],
    };
    const controller = createAppController(deps);

    await controller.hydrate();
    deps.clock.set(NOW + 45 * 60_000);
    await controller.reconcileNow();

    expect(controller.getSnapshot().ready).toBe(true);
    expect(deps.notifications.deliveries).toEqual([{
      title: 'Meow',
      body: 'Time to look into the distance, drink water, and 服药.',
      tag: 'neko-pause-reminder',
    }]);
    expect(deps.audio.plays).toBe(1);

    await controller.complete('lookAway');

    expect(deps.history.events.at(-1)).toMatchObject({
      action: 'completed', reminderType: 'lookAway', occurredAt: NOW + 45 * 60_000,
    });
    expect(controller.getSnapshot().settings.affinity).toBe(1);
    expect(deps.settings.saves.at(-1)?.reminders).toEqual(controller.getSnapshot().scheduler.reminders);
  });

  test('does not deliver again when another reminder joins a non-empty due queue', async () => {
    const settings = enabledSettings(NOW);
    settings.reminders = settings.reminders.map((reminder) => {
      if (reminder.id === 'lookAway') return { ...reminder, nextDueAt: NOW };
      if (reminder.id === 'drinkWater') return { ...reminder, nextDueAt: NOW + 60_000 };
      return reminder;
    });
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.dueQueue).toHaveLength(1);
    expect(deps.notifications.deliveries).toEqual([{
      title: '喵',
      body: '该目视远方了。',
      tag: 'neko-pause-reminder',
    }]);
    expect(deps.audio.plays).toBe(1);

    deps.clock.set(NOW + 60_000);
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.dueQueue).toHaveLength(2);
    expect(deps.notifications.deliveries).toEqual([{
      title: '喵',
      body: '该目视远方了。',
      tag: 'neko-pause-reminder',
    }]);
    expect(deps.audio.plays).toBe(1);
  });

  test('keeps actions live when history persistence fails', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW), historyFailure: true });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.skip('drinkWater');

    expect(controller.getSnapshot().scheduler.reminders.find(({ id }) => id === 'drinkWater')?.nextDueAt)
      .toBe(NOW + 45 * 60_000);
    expect(controller.getSnapshot().nonBlockingError).toBe('history-write-failed');
  });

  test('snoozes, skips, pauses, and resumes while persisting scheduler runtime', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.snooze('lookAway', 10);
    expect(controller.getSnapshot().scheduler.reminders[0]?.snoozedUntil).toBe(NOW + 10 * 60_000);
    expect(deps.history.events.at(-1)?.action).toBe('snoozed');

    await controller.skip('drinkWater');
    expect(deps.history.events.at(-1)?.action).toBe('skipped');

    await controller.pause(30);
    expect(deps.settings.saves.at(-1)?.runtime).toEqual({
      pausedAt: NOW,
      pausedUntil: NOW + 30 * 60_000,
      quietStartedAt: undefined,
    });

    deps.clock.set(NOW + 5 * 60_000);
    await controller.resumePause();
    expect(controller.getSnapshot().scheduler.pausedAt).toBeUndefined();
    expect(deps.settings.saves.at(-1)?.runtime).toEqual({
      pausedAt: undefined, pausedUntil: undefined, quietStartedAt: undefined,
    });
  });

  test('manual resume settles suppression without owning the due queue transition', async () => {
    const settings = enabledSettings(NOW);
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: NOW - 60_000 }
      : reminder);
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(30);

    deps.clock.set(NOW + 5 * 60_000);
    await controller.resumePause();

    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
    expect(deps.notifications.deliveries).toEqual([]);
    expect(deps.audio.plays).toBe(0);

    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.dueQueue.map((item) => item.reminderId)).toEqual(['lookAway']);
    expect(deps.notifications.deliveries).toEqual([{
      title: '喵',
      body: '该目视远方了。',
      tag: 'neko-pause-reminder',
    }]);
    expect(deps.audio.plays).toBe(1);
  });

  test('publishes each successful in-memory mutation once before persistence finishes', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    let releaseSave!: () => void;
    deps.settings.save = vi.fn(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
    const controller = createAppController(deps);
    await controller.hydrate();
    const listener = vi.fn();
    controller.subscribe(listener);

    const pending = controller.pause(30);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().scheduler.pausedUntil).toBe(NOW + 30 * 60_000);
    releaseSave();
    await pending;
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('keeps new settings live and marks temporary mode when settings persistence fails', async () => {
    const deps = createFakeDependencies({ now: NOW, settingsFailure: true });
    const controller = createAppController(deps);
    await controller.hydrate();
    const changed = { ...controller.getSnapshot().settings, theme: 'dark' as const };

    await controller.saveSettings(changed);

    expect(controller.getSnapshot()).toMatchObject({
      settings: { theme: 'dark' },
      storageMode: 'temporary',
      nonBlockingError: 'settings-write-failed',
    });
  });

  test('preserves controller-owned runtime when saving a stale settings draft', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();
    const staleDraft = controller.getSnapshot().settings;
    await controller.pause(30);

    await controller.saveSettings({ ...staleDraft, theme: 'dark' });

    expect(controller.getSnapshot().scheduler.pausedAt).toBe(NOW);
    expect(controller.getSnapshot().scheduler.pausedUntil).toBe(NOW + 30 * 60_000);
    expect(deps.settings.saves.at(-1)?.runtime.pausedUntil).toBe(NOW + 30 * 60_000);
  });

  test('changes only locale when a pause and quiet runtime have both expired', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    await controller.pause(30);
    deps.clock.set(new Date(2026, 6, 12, 8).getTime());
    const before = structuredClone(controller.getSnapshot());

    await controller.setLocale('en');

    expect(controller.getSnapshot()).toEqual({
      ...before,
      settings: { ...before.settings, locale: 'en' },
    });
    expect(deps.settings.value).toEqual({ ...before.settings, locale: 'en' });
  });

  test('settles an expired pause before starting a new pause', async () => {
    const start = new Date(2026, 6, 11, 8).getTime();
    const settings = enabledSettings(start);
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: start + 30 * 60_000 }
      : reminder);
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(60);

    deps.clock.set(new Date(2026, 6, 11, 9, 15).getTime());
    await controller.pause(30);
    deps.clock.set(new Date(2026, 6, 11, 9, 45).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(new Date(2026, 6, 11, 10).getTime());
  });

  test('does not replace an active pause at controller level', async () => {
    const start = new Date(2026, 6, 11, 8).getTime();
    const deps = createFakeDependencies({ now: start, settings: enabledSettings(start) });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(60);

    deps.clock.set(start + 15 * 60_000);
    await controller.pause(30);

    expect(controller.getSnapshot().scheduler).toMatchObject({
      pausedAt: start,
      pausedUntil: start + 60 * 60_000,
    });
  });

  test('still publishes newly active quiet runtime when rejecting a replacement pause', async () => {
    const start = new Date(2026, 6, 11, 8).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 8 * 60 + 30, endMinutes: 10 * 60 };
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(120);

    deps.clock.set(new Date(2026, 6, 11, 9, 15).getTime());
    await controller.pause(30);

    expect(controller.getSnapshot().scheduler).toMatchObject({
      pausedAt: start,
      pausedUntil: start + 120 * 60_000,
      quietStartedAt: new Date(2026, 6, 11, 8, 30).getTime(),
    });
  });

  test('settles expired pause and recurring quiet overlap only once before a new pause', async () => {
    const start = new Date(2026, 6, 11, 8).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 8 * 60 + 30, endMinutes: 9 * 60 + 30 };
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: start + 30 * 60_000 }
      : reminder);
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(60);

    deps.clock.set(new Date(2026, 6, 11, 9, 15).getTime());
    await controller.pause(30);
    deps.clock.set(new Date(2026, 6, 11, 9, 45).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(new Date(2026, 6, 11, 10, 15).getTime());
  });

  test('removes a due item when reminder edits restart it as scheduled', async () => {
    const settings = enabledSettings(NOW);
    const deps = createFakeDependencies({ now: NOW + 45 * 60_000, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.dueQueue.map(({ reminderId }) => reminderId))
      .toContain('drinkWater');

    const current = controller.getSnapshot().settings;
    await controller.saveSettings({
      ...current,
      reminders: current.reminders.map((reminder) => reminder.id === 'drinkWater'
        ? {
          ...reminder,
          intervalMinutes: 75,
          nextDueAt: deps.clock.now() + 75 * 60_000,
          status: 'scheduled',
          snoozedUntil: undefined,
        }
        : reminder),
    });

    expect(controller.getSnapshot().scheduler.dueQueue.map(({ reminderId }) => reminderId))
      .not.toContain('drinkWater');
  });

  test('disabling open quiet hours settles at the save timestamp and never shifts later', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 11, 23).getTime());
    await controller.saveSettings({
      ...controller.getSnapshot().settings,
      quietHours: { ...settings.quietHours, enabled: false },
    });
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBeUndefined();
    expect(deps.settings.saves.at(-1)?.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);

    deps.clock.set(new Date(2026, 6, 12, 1).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);
  });

  test('enabling quiet hours mid-window starts suppression at the save timestamp', async () => {
    const enabledAt = new Date(2026, 6, 11, 23).getTime();
    const settings = enabledSettings(enabledAt);
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: enabledAt, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.saveSettings({
      ...controller.getSnapshot().settings,
      quietHours: { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 },
    });
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBe(enabledAt);

    deps.clock.set(new Date(2026, 6, 12, 7).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 8 * 60 * 60_000);
  });

  test('enabling overnight quiet hours in the morning closes at the same-day end', async () => {
    const enabledAt = new Date(2026, 6, 12, 6).getTime();
    const settings = enabledSettings(enabledAt);
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: enabledAt, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.saveSettings({
      ...controller.getSnapshot().settings,
      quietHours: { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 },
    });
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBe(enabledAt);

    deps.clock.set(new Date(2026, 6, 12, 8).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);
  });

  test('replacing open quiet hours with an active schedule preserves the pause union', async () => {
    const start = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(120);
    deps.clock.set(new Date(2026, 6, 11, 22).getTime());
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 11, 23).getTime());
    await controller.saveSettings({
      ...controller.getSnapshot().settings,
      quietHours: { enabled: true, startMinutes: 21 * 60, endMinutes: 6 * 60 },
    });
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBe(deps.clock.now());

    deps.clock.set(new Date(2026, 6, 12, 6).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 8 * 60 * 60_000 + 10 * 60_000);
  });

  test('replacing open quiet hours with an inactive schedule settles pause overlap once', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    deps.clock.set(new Date(2026, 6, 11, 22, 30).getTime());
    await controller.pause(120);

    deps.clock.set(new Date(2026, 6, 11, 23).getTime());
    await controller.saveSettings({
      ...controller.getSnapshot().settings,
      quietHours: { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 },
    });
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBeUndefined();

    deps.clock.set(new Date(2026, 6, 12, 0, 30).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 2 * 60 * 60_000 + 30 * 60_000);
  });

  test('requests notification permission only on command and publishes the result', async () => {
    const deps = createFakeDependencies({ now: NOW, notificationStatus: 'default' });
    deps.notifications.requestedPermission = 'denied';
    const controller = createAppController(deps);
    expect(deps.notifications.requests).toBe(0);

    await controller.requestNotifications();

    expect(deps.notifications.requests).toBe(1);
    expect(controller.getSnapshot().notificationStatus).toBe('denied');
  });

  test('enters and leaves quiet hours before reconciling and shifts due times', async () => {
    const settings = enabledSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBe(NOW);
    expect(deps.notifications.deliveries).toEqual([]);

    deps.clock.set(NOW + 60 * 60_000);
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBeUndefined();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt).toBe(NOW + 80 * 60_000);
  });

  test('records the actual local quiet boundary when the page sleeps across entry', async () => {
    const beforeQuiet = new Date(2026, 6, 11, 21, 50).getTime();
    const actualQuietStart = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(beforeQuiet);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: beforeQuiet, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    deps.clock.set(new Date(2026, 6, 11, 23, 15).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.quietStartedAt).toBe(actualQuietStart);
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt).toBe(originalDueAt);
    expect(deps.notifications.deliveries).toEqual([]);
  });

  test('closes at the actual local quiet boundary when the page sleeps across exit', async () => {
    const beforeQuiet = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(beforeQuiet);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: beforeQuiet, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.clock.set(new Date(2026, 6, 11, 23, 15).getTime());
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 12, 8, 30).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.quietStartedAt).toBeUndefined();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000);
  });

  test('accounts for a complete quiet window crossed between lifecycle observations', async () => {
    const beforeQuiet = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(beforeQuiet);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: beforeQuiet, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    deps.clock.set(new Date(2026, 6, 12, 8, 30).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000);
  });

  test('accounts for every recurring quiet window crossed during multi-day suspension', async () => {
    const beforeQuiet = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(beforeQuiet);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: beforeQuiet, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.clock.set(new Date(2026, 6, 11, 23).getTime());
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 14, 8, 30).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 27 * 60 * 60_000);
  });

  test('uses the exact interval union when pause and quiet both expire while suspended', async () => {
    const start = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(120);
    deps.clock.set(new Date(2026, 6, 11, 22, 15).getTime());
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 12, 8, 30).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.pausedAt).toBeUndefined();
    expect(controller.getSnapshot().scheduler.quietStartedAt).toBeUndefined();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000 + 10 * 60_000);
  });

  test('counts overlapping pause then quiet time only once', async () => {
    const start = new Date(2026, 6, 11, 21, 50).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(120);

    deps.clock.set(new Date(2026, 6, 11, 22).getTime());
    await controller.reconcileNow();
    deps.clock.set(new Date(2026, 6, 12, 7).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000 + 10 * 60_000);
  });

  test('counts overlapping quiet then pause time only once', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 11, 22, 30).getTime());
    await controller.pause(120);
    deps.clock.set(new Date(2026, 6, 12, 0, 30).getTime());
    await controller.reconcileNow();
    deps.clock.set(new Date(2026, 6, 12, 7).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000);
  });

  test('does not count a manually resumed pause again when quiet time owns the overlap', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();

    deps.clock.set(new Date(2026, 6, 11, 22, 30).getTime());
    await controller.pause(120);
    deps.clock.set(new Date(2026, 6, 11, 23).getTime());
    await controller.resumePause();
    deps.clock.set(new Date(2026, 6, 12, 7).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 9 * 60 * 60_000);
  });

  test('hydrates imported pets and falls back when the selected id is missing', async () => {
    const settings = { ...createDefaultSettings(NOW), activePetId: 'missing' };
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot().settings.activePetId).toBe(BUILTIN_PET_ID);
    expect(controller.getSnapshot().pets).toEqual([]);
    expect(controller.getSnapshot().scheduler.reminders).toEqual(settings.reminders);
    expect(deps.settings.saves.at(-1)?.activePetId).toBe(BUILTIN_PET_ID);
    expect(deps.settings.saves.at(-1)?.reminders).toEqual(settings.reminders);
  });

  test('hydrates a selected imported pet without rewriting scheduler due times', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot().pets).toHaveLength(1);
    expect(controller.getSnapshot().pets[0]).toMatchObject({ id: 'murk', displayName: 'Murk' });
    expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().scheduler.reminders).toEqual(settings.reminders);
    expect(deps.settings.saves).toEqual([]);
  });

  test.each([
    ['with frame metadata', MURK_TEST_PET],
    ['without frame metadata', (({ frameMetadata: _metadata, ...pet }) => pet)(MURK_TEST_PET)],
  ])('hydrates a valid imported pet %s without a library error', async (_case, pet) => {
    const settings = { ...enabledSettings(NOW), activePetId: pet.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(pet.id, pet);
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot().pets).toEqual([
      expect.objectContaining({ id: pet.id }),
    ]);
    expect(controller.getSnapshot().petLibraryError).toBeUndefined();
  });

  test('falls back in memory when pet loading fails without rewriting stored settings', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.list = vi.fn(async () => { throw new Error('pet list failed'); });
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot()).toMatchObject({
      pets: [],
      petLibraryError: 'load-failed',
      settings: { activePetId: BUILTIN_PET_ID },
    });
    expect(controller.getSnapshot().scheduler.reminders).toEqual(settings.reminders);
    expect(deps.settings.saves).toEqual([]);
  });

  test.each([
    ['invalid sprite version', { spriteVersion: 3 }],
    ['non-Blob atlas', { spritesheet: {} }],
  ])('falls back from a selected pet with %s without deleting its stored record', async (_case, invalid) => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    const corrupt = { ...MURK_TEST_PET, ...invalid };
    deps.pets.list = vi.fn(async () => [corrupt as never]);
    deps.pets.values.set(MURK_TEST_PET.id, corrupt as never);
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot().settings.activePetId).toBe(BUILTIN_PET_ID);
    expect(controller.getSnapshot().pets).toEqual([]);
    expect(controller.getSnapshot().petLibraryError).toBe('load-failed');
    expect(deps.settings.saves.at(-1)?.activePetId).toBe(BUILTIN_PET_ID);
    expect(deps.pets.values.has(MURK_TEST_PET.id)).toBe(true);
  });

  test('keeps a valid selected pet when an unrelated inactive record is corrupt', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    const corrupt = { ...MURK_TEST_PET, id: 'corrupt', spriteVersion: 3 };
    deps.pets.list = vi.fn(async () => [MURK_TEST_PET, corrupt as never]);
    const controller = createAppController(deps);

    await controller.hydrate();

    expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().pets).toHaveLength(1);
    expect(controller.getSnapshot().pets[0]?.id).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().petLibraryError).toBe('load-failed');
    expect(deps.settings.saves).toEqual([]);
  });

  test('imports and updates pets only after repository writes succeed', async () => {
    const deps = createFakeDependencies({ now: NOW });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.savePet(MURK_TEST_PET);
    await controller.savePet({ ...MURK_TEST_PET, displayName: 'Changed', importedAt: 999, updatedAt: 200 });

    expect(controller.getSnapshot().pets[0]).toMatchObject({
      ...MURK_TEST_PET,
      displayName: 'Changed',
      importedAt: MURK_TEST_PET.importedAt,
      updatedAt: 200,
      spritesheet: expect.anything(),
    });
    expect(deps.pets.values.get(MURK_TEST_PET.id)?.importedAt).toBe(MURK_TEST_PET.importedAt);
  });

  test('does not replace a stored pet when an update write fails', async () => {
    const deps = createFakeDependencies({ now: NOW });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    deps.pets.putFailure = true;
    const controller = createAppController(deps);
    await controller.hydrate();

    await expect(controller.savePet({ ...MURK_TEST_PET, displayName: 'Changed' })).rejects.toThrow();

    expect(controller.getSnapshot().pets[0]?.displayName).toBe('Murk');
    expect(controller.getSnapshot().petLibraryError).toBe('write-failed');
  });

  test('persists imported and built-in selections without changing scheduler due times', async () => {
    const settings = enabledSettings(NOW);
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    const reminders = controller.getSnapshot().scheduler.reminders;

    await controller.selectPet(MURK_TEST_PET.id);
    await controller.selectPet(BUILTIN_PET_ID);

    expect(deps.settings.saves.map(({ activePetId }) => activePetId))
      .toEqual([MURK_TEST_PET.id, BUILTIN_PET_ID]);
    expect(controller.getSnapshot().scheduler.reminders).toEqual(reminders);
  });

  test('does not let a pending selection save block reconciliation and converges out-of-order writes', async () => {
    const settings = enabledSettings(NOW);
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: NOW, status: 'scheduled' }
      : reminder);
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    let stored: AppSettings | undefined;
    let releaseFirst!: () => void;
    let saveCount = 0;
    deps.settings.save = vi.fn((value) => {
      saveCount += 1;
      const written = structuredClone(value);
      if (saveCount === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = () => {
            stored = written;
            resolve();
          };
        });
      }
      stored = written;
      return Promise.resolve();
    });

    const selecting = controller.selectPet(MURK_TEST_PET.id);
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const reconciling = controller.reconcileNow();
    await vi.waitFor(() => expect(deps.settings.save).toHaveBeenCalledTimes(2));
    await reconciling;

    expect(deps.settings.save).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().scheduler.dueQueue.map(({ reminderId }) => reminderId))
      .toContain('lookAway');
    expect(deps.notifications.deliveries).toEqual([{
      title: '喵',
      body: '该目视远方了。',
      tag: 'neko-pause-reminder',
    }]);
    expect(deps.audio.plays).toBe(0);

    releaseFirst();
    await selecting;

    const current = controller.getSnapshot();
    expect(current.settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(current.settings.reminders).toEqual(current.scheduler.reminders);
    expect(current.settings.runtime).toEqual({
      pausedAt: current.scheduler.pausedAt,
      pausedUntil: current.scheduler.pausedUntil,
      quietStartedAt: current.scheduler.quietStartedAt,
    });
    expect(current.scheduler.dueQueue.map(({ reminderId }) => reminderId)).toContain('lookAway');
    expect(deps.settings.save).toHaveBeenCalledTimes(3);
    expect(stored).toMatchObject({
      activePetId: MURK_TEST_PET.id,
      reminders: current.scheduler.reminders,
      runtime: current.settings.runtime,
    });
  });

  test('reports selection persistence failures without changing scheduler state', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    const scheduler = controller.getSnapshot().scheduler;
    deps.settings.saveFailure = true;

    await expect(controller.selectPet(MURK_TEST_PET.id)).rejects.toThrow('settings save failed');

    expect(controller.getSnapshot()).toMatchObject({
      storageMode: 'temporary',
      nonBlockingError: 'settings-write-failed',
    });
    expect(controller.getSnapshot().scheduler).toEqual(scheduler);
  });

  test('lets concurrent reconciliation recover after a stale selection write fails', async () => {
    const settings = enabledSettings(NOW);
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: NOW, status: 'scheduled' }
      : reminder);
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    let rejectFirst!: (error: Error) => void;
    const persisted: AppSettings[] = [];
    deps.settings.save = vi.fn((value) => {
      persisted.push(structuredClone(value));
      if (persisted.length === 1) {
        return new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
      }
      return Promise.resolve();
    });

    const selecting = controller.selectPet(MURK_TEST_PET.id);
    await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
    const reconciling = controller.reconcileNow();
    rejectFirst(new Error('settings save failed'));
    await selecting;
    await reconciling;

    const current = controller.getSnapshot();
    expect(current.storageMode).toBe('persistent');
    expect(current.nonBlockingError).toBeUndefined();
    expect(persisted.at(-1)).toMatchObject({
      activePetId: MURK_TEST_PET.id,
      reminders: current.scheduler.reminders,
    });
  });

  test('deletes an inactive pet before publishing the reduced library', async () => {
    const deps = createFakeDependencies({ now: NOW });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    let releaseDelete!: () => void;
    deps.pets.delete = vi.fn(() => new Promise<void>((resolve) => { releaseDelete = resolve; }));

    const deleting = controller.deletePet(MURK_TEST_PET.id);
    expect(controller.getSnapshot().pets[0]).toMatchObject({ id: 'murk', displayName: 'Murk' });
    releaseDelete();
    await deleting;

    expect(controller.getSnapshot().pets).toEqual([]);
  });

  test('deletes an active pet and publishes the built-in fallback atomically', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.deletePet(MURK_TEST_PET.id);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      pets: [],
      settings: { activePetId: BUILTIN_PET_ID },
    });
    expect(deps.settings.saves.at(-1)?.activePetId).toBe(BUILTIN_PET_ID);
  });

  test('keeps an active pet visible until fallback persistence commits once', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    let releaseSave!: () => void;
    deps.settings.save = vi.fn(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
    const listener = vi.fn();
    controller.subscribe(listener);

    const deleting = controller.deletePet(MURK_TEST_PET.id);
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'));

    expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().pets[0]?.id).toBe(MURK_TEST_PET.id);
    expect(listener).not.toHaveBeenCalled();

    releaseSave();
    await deleting;

    expect(controller.getSnapshot().settings.activePetId).toBe(BUILTIN_PET_ID);
    expect(controller.getSnapshot().pets).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('converges active deletion with concurrent reconciliation without stale scheduler publication', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, nextDueAt: NOW, status: 'scheduled' }
      : reminder);
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    let stored: AppSettings | undefined;
    let releaseFirst!: () => void;
    let saveCount = 0;
    deps.settings.save = vi.fn((value) => {
      saveCount += 1;
      const written = structuredClone(value);
      if (saveCount === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = () => {
            stored = written;
            resolve();
          };
        });
      }
      stored = written;
      return Promise.resolve();
    });

    const deleting = controller.deletePet(MURK_TEST_PET.id);
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const reconciling = controller.reconcileNow();
    await vi.waitFor(() => expect(deps.settings.save).toHaveBeenCalledTimes(2));
    await reconciling;
    expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().pets[0]?.id).toBe(MURK_TEST_PET.id);
    releaseFirst();
    await deleting;

    const current = controller.getSnapshot();
    expect(current.settings.activePetId).toBe(BUILTIN_PET_ID);
    expect(current.settings.reminders).toEqual(current.scheduler.reminders);
    expect(current.settings.runtime).toEqual({
      pausedAt: current.scheduler.pausedAt,
      pausedUntil: current.scheduler.pausedUntil,
      quietStartedAt: current.scheduler.quietStartedAt,
    });
    expect(current.scheduler.dueQueue.map(({ reminderId }) => reminderId)).toContain('lookAway');
    expect(deps.settings.save).toHaveBeenCalledTimes(3);
    expect(stored).toMatchObject({
      activePetId: BUILTIN_PET_ID,
      reminders: current.scheduler.reminders,
      runtime: current.settings.runtime,
    });
  });

  test('restores an active pet when fallback selection persistence fails', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.settings.saveFailure = true;

    const observed: Array<{ activePetId: string; petIds: string[] }> = [];
    controller.subscribe(() => observed.push({
      activePetId: controller.getSnapshot().settings.activePetId,
      petIds: controller.getSnapshot().pets.map(({ id }) => id),
    }));

    await expect(controller.deletePet(MURK_TEST_PET.id)).rejects.toThrow('settings save failed');

    expect(deps.pets.values.get(MURK_TEST_PET.id)).toMatchObject({ id: 'murk', displayName: 'Murk' });
    expect(controller.getSnapshot().settings.activePetId).toBe(MURK_TEST_PET.id);
    expect(controller.getSnapshot().pets[0]).toMatchObject({ id: 'murk', displayName: 'Murk' });
    expect(observed.every(({ activePetId, petIds }) => (
      activePetId === MURK_TEST_PET.id && petIds.includes(MURK_TEST_PET.id)
    ))).toBe(true);
  });

  test('publishes a safe fallback if active deletion compensation also fails', async () => {
    const settings = { ...enabledSettings(NOW), activePetId: MURK_TEST_PET.id };
    const deps = createFakeDependencies({ now: NOW, settings });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.settings.saveFailure = true;
    deps.pets.putFailure = true;

    await expect(controller.deletePet(MURK_TEST_PET.id)).rejects.toThrow('settings save failed');

    expect(controller.getSnapshot()).toMatchObject({
      pets: [],
      petLibraryError: 'write-failed',
      settings: { activePetId: BUILTIN_PET_ID },
      storageMode: 'temporary',
      nonBlockingError: 'settings-write-failed',
    });
  });

  test('normalizes and persists pet position without changing scheduler due times', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();
    const reminders = controller.getSnapshot().scheduler.reminders;

    await controller.savePetPosition({ xRatio: 1.4, yRatio: -0.25 });

    expect(controller.getSnapshot().settings.petPosition).toEqual({ xRatio: 1, yRatio: 0 });
    expect(deps.settings.saves.at(-1)?.petPosition).toEqual({ xRatio: 1, yRatio: 0 });
    expect(controller.getSnapshot().scheduler.reminders).toEqual(reminders);
  });

  test('uses default pet position ratios for non-finite values', async () => {
    const deps = createFakeDependencies({ now: NOW });
    const controller = createAppController(deps);
    await controller.hydrate();

    await controller.savePetPosition({ xRatio: Number.NaN, yRatio: Number.POSITIVE_INFINITY });

    expect(controller.getSnapshot().settings.petPosition).toEqual({ xRatio: 0.82, yRatio: 0.72 });
    expect(deps.settings.saves.at(-1)?.petPosition).toEqual({ xRatio: 0.82, yRatio: 0.72 });
  });

  test('lists history and clears all local data before resetting to defaults', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.complete('lookAway');
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);

    expect(await controller.listHistorySince(NOW)).toHaveLength(1);
    await controller.clearAll();

    expect(deps.settings.cleared).toBe(true);
    expect(deps.history.cleared).toBe(true);
    expect(deps.pets.cleared).toBe(true);
    expect(controller.getSnapshot().settings.onboardingComplete).toBe(false);
    expect(controller.getSnapshot().pets).toEqual([]);
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
  });

  test('does not reset the snapshot when clearing either repository fails', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    deps.history.clearFailure = true;
    const controller = createAppController(deps);
    await controller.hydrate();

    await expect(controller.clearAll()).rejects.toThrow('history clear failed');
    expect(deps.settings.cleared).toBe(true);
    expect(deps.history.cleared).toBe(false);
    expect(controller.getSnapshot().settings.soundEnabled).toBe(true);
  });

  test('does not reset the snapshot when pet clearing fails', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    deps.pets.values.set(MURK_TEST_PET.id, MURK_TEST_PET);
    deps.pets.clearFailure = true;
    const controller = createAppController(deps);
    await controller.hydrate();

    await expect(controller.clearAll()).rejects.toThrow('pet clear failed');

    expect(controller.getSnapshot().settings.soundEnabled).toBe(true);
    expect(controller.getSnapshot().pets).toHaveLength(1);
  });

  test('waits for pet clearing before publishing the reset snapshot', async () => {
    const settings = enabledSettings(NOW);
    settings.onboardingComplete = true;
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    let releasePets!: () => void;
    deps.pets.clear = vi.fn(() => new Promise<void>((resolve) => { releasePets = resolve; }));

    const clearing = controller.clearAll();
    await Promise.resolve();
    expect(controller.getSnapshot().settings.onboardingComplete).toBe(true);
    releasePets();
    await clearing;

    expect(controller.getSnapshot().settings.onboardingComplete).toBe(false);
  });

  test('attempts both repository clears and keeps the snapshot when settings clear fails', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    deps.settings.clearFailure = true;
    const controller = createAppController(deps);
    await controller.hydrate();

    await expect(controller.clearAll()).rejects.toThrow('settings clear failed');
    expect(deps.settings.cleared).toBe(false);
    expect(deps.history.cleared).toBe(true);
    expect(controller.getSnapshot().settings.onboardingComplete).toBe(false);
    expect(controller.getSnapshot().settings.soundEnabled).toBe(true);
  });

  test('waits for both clear attempts before rejecting and permits a successful retry', async () => {
    const settings = enabledSettings(NOW);
    settings.onboardingComplete = true;
    const deps = createFakeDependencies({ now: NOW, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    let releaseHistory!: () => void;
    deps.settings.clear = vi.fn(async () => { throw new Error('settings clear failed'); });
    deps.history.clear = vi.fn(() => new Promise<void>((resolve) => { releaseHistory = resolve; }));
    let settled = false;
    const clearing = controller.clearAll();
    void clearing.finally(() => { settled = true; }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(controller.getSnapshot().settings.onboardingComplete).toBe(true);
    releaseHistory();
    await expect(clearing).rejects.toThrow('local data clear failed');
    deps.settings.clear = vi.fn(async () => undefined);
    deps.history.clear = vi.fn(async () => undefined);
    await controller.clearAll();
    expect(controller.getSnapshot().settings.onboardingComplete).toBe(false);
  });

  test('clears only a recovered settings-write error after a successful settings save', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();
    deps.settings.saveFailure = true;
    await controller.saveSettings(controller.getSnapshot().settings);
    expect(controller.getSnapshot()).toMatchObject({ storageMode: 'temporary', nonBlockingError: 'settings-write-failed' });
    deps.settings.saveFailure = false;
    await controller.saveSettings(controller.getSnapshot().settings);
    expect(controller.getSnapshot().storageMode).toBe('persistent');
    expect(controller.getSnapshot().nonBlockingError).toBeUndefined();
  });

  test('does not clear a history-write error when settings persist successfully', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW), historyFailure: true });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.complete('lookAway');
    expect(controller.getSnapshot().nonBlockingError).toBe('history-write-failed');
    await controller.saveSettings(controller.getSnapshot().settings);
    expect(controller.getSnapshot().nonBlockingError).toBe('history-write-failed');
  });

  test('publishes history revision only after successful appends', async () => {
    const deps = createFakeDependencies({ now: NOW, settings: enabledSettings(NOW) });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.complete('lookAway');
    expect(controller.getSnapshot().historyRevision).toBe(1);
    deps.history.appendFailure = true;
    await controller.complete('drinkWater');
    expect(controller.getSnapshot().historyRevision).toBe(1);
  });

  test('restarted reminder during pause becomes due one full interval after resume', async () => {
    const start = new Date(2026, 6, 11, 9).getTime();
    const deps = createFakeDependencies({ now: start, settings: enabledSettings(start) });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.pause(30);
    deps.clock.set(new Date(2026, 6, 11, 9, 10).getTime());
    const current = controller.getSnapshot().settings;
    await controller.saveSettings({
      ...current,
      reminders: current.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, intervalMinutes: 25, nextDueAt: start + 25 * 60_000, status: 'scheduled' }
        : reminder),
    });
    deps.clock.set(new Date(2026, 6, 11, 9, 20).getTime());
    await controller.resumePause();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(new Date(2026, 6, 11, 9, 45).getTime());
  });

  test('restarted reminder during quiet hours becomes due one full interval after quiet ends', async () => {
    const start = new Date(2026, 6, 11, 22).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();
    deps.clock.set(new Date(2026, 6, 11, 22, 10).getTime());
    const current = controller.getSnapshot().settings;
    await controller.saveSettings({
      ...current,
      reminders: current.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, intervalMinutes: 25, nextDueAt: start + 25 * 60_000, status: 'scheduled' }
        : reminder),
    });
    deps.clock.set(new Date(2026, 6, 12, 7).getTime());
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(new Date(2026, 6, 12, 7, 25).getTime());
  });

  test('keeps a restarted reminder draft when its new due time equals the old due time', async () => {
    const start = new Date(2026, 6, 11, 9).getTime();
    const saveAt = new Date(2026, 6, 11, 9, 15).getTime();
    const oldDueAt = new Date(2026, 6, 11, 9, 45).getTime();
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    settings.reminders = settings.reminders.map((reminder) => reminder.id === 'lookAway'
      ? { ...reminder, intervalMinutes: 45, nextDueAt: oldDueAt }
      : reminder);
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();
    await controller.reconcileNow();

    deps.clock.set(saveAt);
    const current = controller.getSnapshot().settings;
    await controller.saveSettings({
      ...current,
      quietHours: { ...current.quietHours, enabled: false },
      reminders: current.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, intervalMinutes: 30, nextDueAt: oldDueAt, status: 'scheduled' }
        : reminder),
    });

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt).toBe(oldDueAt);
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
    deps.clock.set(oldDueAt);
    await controller.reconcileNow();
    expect(controller.getSnapshot().scheduler.reminders[0]?.status).toBe('due');
    expect(controller.getSnapshot().scheduler.dueQueue.map(({ reminderId }) => reminderId))
      .toContain('lookAway');
  });
});

describe('isQuietAt', () => {
  test('supports daytime ranges, overnight ranges, and disabled quiet hours', () => {
    const at = (hours: number, minutes = 0) => new Date(2026, 6, 11, hours, minutes).getTime();
    expect(isQuietAt(at(9, 30), { enabled: true, startMinutes: 540, endMinutes: 600 })).toBe(true);
    expect(isQuietAt(at(10), { enabled: true, startMinutes: 540, endMinutes: 600 })).toBe(false);
    expect(isQuietAt(at(23), { enabled: true, startMinutes: 1320, endMinutes: 420 })).toBe(true);
    expect(isQuietAt(at(6), { enabled: true, startMinutes: 1320, endMinutes: 420 })).toBe(true);
    expect(isQuietAt(at(12), { enabled: false, startMinutes: 0, endMinutes: 1439 })).toBe(false);
  });

  test('accepts only a runtime start inside the current overnight window', () => {
    const quiet = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const now = new Date(2026, 6, 12, 1, 30).getTime();
    const currentStart = new Date(2026, 6, 11, 22).getTime();
    const previousStart = new Date(2026, 6, 10, 22).getTime();

    expect(isCurrentQuietRuntime(currentStart, now, quiet)).toBe(true);
    expect(isCurrentQuietRuntime(previousStart, now, quiet)).toBe(false);
    expect(isCurrentQuietRuntime(currentStart, new Date(2026, 6, 12, 7).getTime(), quiet)).toBe(false);
  });

  test('uses local minute membership for both occurrences of a fallback hour', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
    const quiet = { enabled: true, startMinutes: 60, endMinutes: 90 };
    const first0115 = Date.parse('2026-10-25T00:15:00Z');
    const second0115 = Date.parse('2026-10-25T01:15:00Z');

    expect(isQuietAt(first0115, quiet)).toBe(true);
    expect(isQuietAt(second0115, quiet)).toBe(true);
    expect(isCurrentQuietRuntime(Date.parse('2026-10-25T00:00:00Z'), second0115, quiet)).toBe(false);
    expect(isCurrentQuietRuntime(Date.parse('2026-10-25T01:00:00Z'), second0115, quiet)).toBe(true);
  });

  test('rejects a future quiet runtime anchor', () => {
    const quiet = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    const now = new Date(2026, 6, 11, 9, 15).getTime();
    expect(isCurrentQuietRuntime(now + 5 * 60_000, now, quiet)).toBe(false);
  });

  test('treats a spring-forward quiet window as one continuous real interval', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
    const start = Date.parse('2026-03-29T00:15:00Z');
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 30, endMinutes: 150 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    deps.clock.set(Date.parse('2026-03-29T02:00:00Z'));
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);
  });

  test('starts a spring-forward window at the first existing member minute', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
    const start = Date.parse('2026-03-29T00:15:00Z');
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 90, endMinutes: 180 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    deps.clock.set(Date.parse('2026-03-29T03:15:00Z'));
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);
  });

  test('settles both disjoint fallback occurrences with the same local minute membership', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London');
    const start = Date.parse('2026-10-24T23:45:00Z');
    const settings = enabledSettings(start);
    settings.quietHours = { enabled: true, startMinutes: 60, endMinutes: 90 };
    const originalDueAt = settings.reminders[0]!.nextDueAt;
    const deps = createFakeDependencies({ now: start, settings });
    const controller = createAppController(deps);
    await controller.hydrate();

    deps.clock.set(Date.parse('2026-10-25T02:00:00Z'));
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[0]?.nextDueAt)
      .toBe(originalDueAt + 60 * 60_000);
  });
});
