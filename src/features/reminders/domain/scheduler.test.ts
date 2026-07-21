import { expect, test } from 'vitest';
import {
  completeReminder, createCustomReminder, createReminder, pauseScheduler, reconcile, resumeScheduler,
  setQuietState, skipReminder, snoozeReminder,
} from './scheduler';

const NOW = Date.UTC(2026, 6, 11, 9);

test('creates a reminder with an absolute due time', () => {
  expect(createReminder('drinkWater', 45, NOW).nextDueAt).toBe(NOW + 45 * 60_000);
});

test('schedules a custom reminder through the shared queue', () => {
  const reminder = createCustomReminder('custom-medicine', '吃药', 30, NOW, true);
  const due = reconcile({ reminders: [reminder], dueQueue: [] }, reminder.nextDueAt);
  const stillDue = reconcile(due, reminder.nextDueAt + 1_000);

  expect(due.dueQueue).toEqual([{ reminderId: 'custom-medicine', dueAt: NOW + 30 * 60_000 }]);
  expect(stillDue.dueQueue).toEqual(due.dueQueue);
  expect(due.reminders[0]).toMatchObject({ kind: 'custom', label: '吃药', status: 'due' });
  expect(completeReminder(due, reminder.id, NOW + 1_000).reminders[0]).toMatchObject({
    status: 'scheduled',
    nextDueAt: NOW + 1_000 + 30 * 60_000,
  });
  expect(snoozeReminder(due, reminder.id, 10, NOW + 1_000)).toMatchObject({
    reminders: [expect.objectContaining({ status: 'snoozed', snoozedUntil: NOW + 1_000 + 10 * 60_000 })],
    dueQueue: [],
  });
  expect(skipReminder(due, reminder.id, NOW + 1_000)).toMatchObject({
    reminders: [expect.objectContaining({ status: 'scheduled', nextDueAt: NOW + 1_000 + 30 * 60_000 })],
    dueQueue: [],
  });
});

test('creates a disabled custom reminder without scheduling it', () => {
  const reminder = createCustomReminder('custom-tea', '泡茶', 15, NOW, false);
  expect(reminder.status).toBe('disabled');
  expect(reconcile({ reminders: [reminder], dueQueue: [] }, NOW + 60 * 60_000).dueQueue).toEqual([]);
});

test('queues an overdue reminder once', () => {
  const reminder = createReminder('lookAway', 20, NOW);
  const first = reconcile({ reminders: [reminder], dueQueue: [] }, reminder.nextDueAt);
  const second = reconcile(first, reminder.nextDueAt + 60_000);
  expect(first.dueQueue).toHaveLength(1);
  expect(second.dueQueue).toHaveLength(1);
});

test('complete, snooze, and skip calculate the specified next times', () => {
  const reminder = createReminder('standUp', 60, NOW);
  const due = reconcile({ reminders: [reminder], dueQueue: [] }, reminder.nextDueAt);
  expect(completeReminder(due, reminder.id, NOW + 1000).reminders[0]!.nextDueAt).toBe(NOW + 1000 + 60 * 60_000);
  expect(snoozeReminder(due, reminder.id, 10, NOW).reminders[0]!.snoozedUntil).toBe(NOW + 10 * 60_000);
  expect(skipReminder(due, reminder.id, NOW).reminders[0]!.nextDueAt).toBe(NOW + 60 * 60_000);
});

test('pause and quiet time shift due timestamps instead of creating backlog', () => {
  const base = { reminders: [createReminder('takeBreak', 90, NOW)], dueQueue: [] };
  const paused = pauseScheduler(base, NOW, 30);
  expect(reconcile(paused, NOW + 30 * 60_000).reminders[0]!.nextDueAt).toBe(NOW + 120 * 60_000);
  expect(resumeScheduler(paused, NOW + 10 * 60_000).reminders[0]!.nextDueAt).toBe(NOW + 100 * 60_000);
  const quiet = setQuietState(base, true, NOW);
  expect(setQuietState(quiet, false, NOW + 8 * 60 * 60_000).reminders[0]!.nextDueAt).toBe(NOW + 9.5 * 60 * 60_000);
});

test('rejects interval values outside 1 through 720', () => {
  expect(() => createReminder('drinkWater', 0, NOW)).toThrow(RangeError);
  expect(() => createReminder('drinkWater', 721, NOW)).toThrow(RangeError);
});
test('orders simultaneous due items and never duplicates them', () => {
  const later = createReminder('standUp', 60, NOW);
  const sooner = createReminder('drinkWater', 45, NOW);
  const once = reconcile({ reminders: [later, sooner], dueQueue: [] }, later.nextDueAt);
  const twice = reconcile(once, later.nextDueAt + 1);
  expect(once.dueQueue.map((item) => item.reminderId)).toEqual(['drinkWater', 'standUp']);
  expect(twice.dueQueue).toEqual(once.dueQueue);
});
test('does not queue disabled reminders and re-queues after snooze expires', () => {
  const disabled = { ...createReminder('lookAway', 20, NOW), enabled: false, status: 'disabled' as const };
  expect(reconcile({ reminders: [disabled], dueQueue: [] }, NOW + 30 * 60_000).dueQueue).toEqual([]);
  const due = reconcile({ reminders: [createReminder('takeBreak', 90, NOW)], dueQueue: [] }, NOW + 90 * 60_000);
  const snoozed = snoozeReminder(due, 'takeBreak', 5, NOW + 90 * 60_000);
  expect(reconcile(snoozed, NOW + 95 * 60_000).dueQueue).toHaveLength(1);
});

test('resumes and shifts a pause that started at epoch zero', () => {
  const reminder = createReminder('lookAway', 20, 0);
  const state = {
    reminders: [reminder],
    dueQueue: [],
    pausedAt: 0,
    pausedUntil: 30 * 60_000,
  };

  const resumed = reconcile(state, 30 * 60_000);

  expect(resumed.pausedAt).toBeUndefined();
  expect(resumed.pausedUntil).toBeUndefined();
  expect(resumed.reminders[0]!.nextDueAt).toBe(50 * 60_000);
  expect(resumed.dueQueue).toEqual([]);
});

test('resumes and shifts a pause that expired at epoch zero', () => {
  const pausedAt = -30 * 60_000;
  const reminder = createReminder('drinkWater', 20, pausedAt);
  const state = {
    reminders: [reminder],
    dueQueue: [],
    pausedAt,
    pausedUntil: 0,
  };

  const resumed = reconcile(state, 0);

  expect(resumed.pausedAt).toBeUndefined();
  expect(resumed.pausedUntil).toBeUndefined();
  expect(resumed.reminders[0]!.nextDueAt).toBe(20 * 60_000);
  expect(resumed.dueQueue).toEqual([]);
});

test('suppresses reconciliation when quiet time started at epoch zero', () => {
  const reminder = createReminder('standUp', 5, 0);
  const state = { reminders: [reminder], dueQueue: [], quietStartedAt: 0 };

  const quiet = reconcile(state, 10 * 60_000);

  expect(quiet).toBe(state);
  expect(quiet.dueQueue).toEqual([]);
  expect(quiet.reminders[0]!.status).toBe('scheduled');
});
