import { afterEach, expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../app/defaults';
import type { AppSnapshot, QuietHours } from '../app/model';
import type { SchedulerState } from '../features/reminders/domain/types';
import { startBrowserLifecycle } from './browserLifecycle';

const NOW = new Date(2026, 6, 11, 9).getTime();
const MAX_TIMEOUT_MS = 2_147_483_647;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function snapshotWithReminder(
  now: number,
  schedulerOverrides: Partial<SchedulerState> = {},
  quietHours?: QuietHours,
): AppSnapshot {
  const settings = createDefaultSettings(now);
  if (quietHours !== undefined) settings.quietHours = quietHours;
  settings.reminders[0] = {
    ...settings.reminders[0]!,
    enabled: true,
    status: 'scheduled',
    nextDueAt: now + 5_000,
  };
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

function createLifecycleController(initialSnapshot?: AppSnapshot) {
  const settings = createDefaultSettings(NOW);
  let snapshot: AppSnapshot = initialSnapshot ?? {
    ready: true,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [] },
    storageMode: 'persistent',
    notificationStatus: 'default',
    pets: [],
  };
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const reconcileNow = vi.fn(async () => {
    const dueReminder = snapshot.scheduler.reminders.find((reminder) => (
      reminder.enabled && reminder.nextDueAt <= Date.now()
    ));
    if (dueReminder === undefined) return;
    snapshot = {
      ...snapshot,
      scheduler: {
        ...snapshot.scheduler,
        dueQueue: [{
          reminderId: dueReminder.id,
          dueAt: dueReminder.nextDueAt,
        }],
      },
    };
    publish();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconcileNow,
    publishReminderDueAt(dueAt: number) {
      const reminders = snapshot.scheduler.reminders.map((reminder) => reminder.id === 'lookAway'
        ? { ...reminder, enabled: true, status: 'scheduled' as const, nextDueAt: dueAt }
        : reminder);
      snapshot = {
        ...snapshot,
        settings: { ...snapshot.settings, reminders },
        scheduler: { ...snapshot.scheduler, reminders, dueQueue: [] },
      };
      publish();
    },
  };
}

function createDeferredLifecycleController() {
  const controller = createLifecycleController();
  let finish: (() => void) | undefined;
  controller.reconcileNow.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finish = resolve;
  }));
  return {
    ...controller,
    finishReconcile: () => finish?.(),
  };
}

test('reconciles at a newly published exact due time without waiting for safety polling', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const controller = createLifecycleController();
  const stop = startBrowserLifecycle(controller);

  controller.publishReminderDueAt(NOW + 5_000);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(controller.reconcileNow).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  stop();
});

test('replaces stale exact timers and keeps only the latest due time', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const controller = createLifecycleController();
  const stop = startBrowserLifecycle(controller);

  controller.publishReminderDueAt(NOW + 10_000);
  controller.publishReminderDueAt(NOW + 20_000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  stop();
});

test('reconciles on the safety interval, focus, and visibility changes', async () => {
  vi.useFakeTimers();
  const controller = createLifecycleController();
  const stop = startBrowserLifecycle(controller);

  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('focus'));
  await vi.runAllTicks();
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.runAllTicks();
  expect(controller.reconcileNow).toHaveBeenCalledTimes(3);

  stop();
});

test('coalesces overlapping triggers and cleanup removes every trigger', async () => {
  vi.useFakeTimers();
  const controller = createDeferredLifecycleController();
  const stop = startBrowserLifecycle(controller);

  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  controller.finishReconcile();
  await vi.runAllTicks();
  await Promise.resolve();
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);

  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
});

test('cleanup unsubscribes and clears both stale and newly published exact wakes', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const controller = createLifecycleController();
  const stop = startBrowserLifecycle(controller);

  controller.publishReminderDueAt(NOW + 5_000);
  stop();
  controller.publishReminderDueAt(NOW + 10_000);
  await vi.advanceTimersByTimeAsync(20_000);

  expect(controller.reconcileNow).not.toHaveBeenCalled();
});

test('cleanup during reconciliation prevents a pending follow-up after resolution', async () => {
  vi.useFakeTimers();
  const controller = createDeferredLifecycleController();
  const stop = startBrowserLifecycle(controller);

  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('focus'));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  stop();
  controller.finishReconcile();
  await vi.runAllTicks();
  await Promise.resolve();

  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
});

test('releases the reconciliation lock after rejection without retry spinning', async () => {
  vi.useFakeTimers();
  const controller = createLifecycleController();
  controller.reconcileNow.mockRejectedValueOnce(new Error('transient lifecycle failure'));
  const stop = startBrowserLifecycle(controller);

  window.dispatchEvent(new Event('focus'));
  await vi.runAllTicks();
  await Promise.resolve();
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new Event('focus'));
  await vi.runAllTicks();
  await Promise.resolve();
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  stop();
});

test('chunks wakes beyond the platform timeout and does not deliver early', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(window, 'setInterval').mockImplementation(
    () => 1 as unknown as ReturnType<typeof window.setInterval>,
  );
  const snapshot = snapshotWithReminder(NOW);
  snapshot.settings.reminders[0]!.nextDueAt = NOW + MAX_TIMEOUT_MS + 5_000;
  snapshot.scheduler.reminders = snapshot.settings.reminders;
  const controller = createLifecycleController(snapshot);
  const stop = startBrowserLifecycle(controller);

  await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);

  await vi.advanceTimersByTimeAsync(4_999);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().scheduler.dueQueue).toHaveLength(1);
  stop();
});

test.each([
  {
    name: 'pause-only suppression',
    now: NOW,
    scheduler: { pausedAt: NOW, pausedUntil: NOW + 20 * 60_000 },
    quietHours: undefined,
    boundary: NOW + 20 * 60_000,
  },
  {
    name: 'quiet-only suppression',
    now: NOW,
    scheduler: { quietStartedAt: NOW },
    quietHours: { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 },
    boundary: new Date(2026, 6, 11, 10).getTime(),
  },
  {
    name: 'overlapping suppression chooses the earliest boundary',
    now: NOW,
    scheduler: {
      pausedAt: NOW,
      pausedUntil: NOW + 20 * 60_000,
      quietStartedAt: NOW,
    },
    quietHours: { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 },
    boundary: NOW + 20 * 60_000,
  },
  {
    name: 'overnight quiet suppression',
    now: new Date(2026, 6, 11, 23).getTime(),
    scheduler: { quietStartedAt: new Date(2026, 6, 11, 23).getTime() },
    quietHours: { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 },
    boundary: new Date(2026, 6, 12, 7).getTime(),
  },
  {
    name: 'fallback-hour quiet suppression',
    now: Date.parse('2026-10-25T01:15:00Z'),
    scheduler: { quietStartedAt: Date.parse('2026-10-25T01:00:00Z') },
    quietHours: { enabled: true, startMinutes: 60, endMinutes: 90 },
    boundary: Date.parse('2026-10-25T01:30:00Z'),
  },
] as const)('wakes at the real $name boundary without premature reconciliation', async ({
  now, scheduler, quietHours, boundary,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(window, 'setInterval').mockImplementation(
    () => 1 as unknown as ReturnType<typeof window.setInterval>,
  );
  const controller = createLifecycleController(snapshotWithReminder(now, scheduler, quietHours));
  const stop = startBrowserLifecycle(controller);

  await vi.advanceTimersByTimeAsync(boundary - now - 1);
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  stop();
});
