import type {
  CustomReminder, DueItem, PresetReminder, PresetReminderType, Reminder, SchedulerState,
} from './types';

const minute = 60_000;
const replace = (state: SchedulerState, next: Reminder): SchedulerState => ({
  ...state, reminders: state.reminders.map((item) => item.id === next.id ? next : item),
});
const withoutDue = (state: SchedulerState, id: string) => state.dueQueue.filter((item) => item.reminderId !== id);

const assertInterval = (value: number): void => {
  if (!Number.isInteger(value) || value < 1 || value > 720) throw new RangeError('intervalMinutes');
};

export function createReminder(type: PresetReminderType, intervalMinutes: number, now: number): PresetReminder {
  assertInterval(intervalMinutes);
  return {
    id: type,
    kind: 'preset',
    type,
    enabled: true,
    intervalMinutes,
    nextDueAt: now + intervalMinutes * minute,
    status: 'scheduled',
  };
}

export function createCustomReminder(
  id: string,
  label: string,
  intervalMinutes: number,
  now: number,
  enabled: boolean,
): CustomReminder {
  assertInterval(intervalMinutes);
  return {
    id,
    kind: 'custom',
    label,
    enabled,
    intervalMinutes,
    nextDueAt: now + intervalMinutes * minute,
    status: enabled ? 'scheduled' : 'disabled',
  };
}

export function reconcile(state: SchedulerState, now: number): SchedulerState {
  if (state.pausedUntil !== undefined && now >= state.pausedUntil && state.pausedAt !== undefined) return reconcile(resumeScheduler(state, state.pausedUntil), now);
  if ((state.pausedUntil !== undefined && now < state.pausedUntil) || state.quietStartedAt !== undefined) return state;
  const queued = new Set(state.dueQueue.map((item) => item.reminderId));
  const dueQueue: DueItem[] = [...state.dueQueue];
  const reminders = state.reminders.map((r) => {
    const dueAt = r.snoozedUntil ?? r.nextDueAt;
    if (!r.enabled || dueAt > now || queued.has(r.id)) return r;
    dueQueue.push({ reminderId: r.id, dueAt });
    queued.add(r.id);
    return { ...r, status: 'due' as const };
  });
  return { ...state, reminders, dueQueue: dueQueue.sort((a, b) => a.dueAt - b.dueAt) };
}

export function completeReminder(state: SchedulerState, id: string, now: number): SchedulerState {
  const r = reminderById(state, id);
  return { ...replace(state, { ...r, status: 'scheduled', nextDueAt: now + r.intervalMinutes * minute, snoozedUntil: undefined }), dueQueue: withoutDue(state, id) };
}
export function skipReminder(state: SchedulerState, id: string, now: number) { return completeReminder(state, id, now); }
export function snoozeReminder(state: SchedulerState, id: string, minutes: 5 | 10 | 15, now: number): SchedulerState {
  const r = reminderById(state, id);
  return { ...replace(state, { ...r, status: 'snoozed', snoozedUntil: now + minutes * minute }), dueQueue: withoutDue(state, id) };
}

function reminderById(state: SchedulerState, id: string): Reminder {
  const reminder = state.reminders.find((item) => item.id === id);
  if (reminder === undefined) throw new RangeError(`Unknown reminder: ${id}`);
  return reminder;
}
export function pauseScheduler(state: SchedulerState, now: number, minutes: 30 | 60 | 120): SchedulerState {
  return { ...state, pausedAt: now, pausedUntil: now + minutes * minute };
}
export function resumeScheduler(state: SchedulerState, now: number): SchedulerState {
  if (state.pausedAt === undefined) return state;
  const end = Math.min(now, state.pausedUntil ?? now);
  const delta = Math.max(0, end - state.pausedAt);
  return { ...state, pausedAt: undefined, pausedUntil: undefined, reminders: state.reminders.map((r) => ({ ...r, nextDueAt: r.nextDueAt + delta })) };
}
export function setQuietState(state: SchedulerState, active: boolean, now: number): SchedulerState {
  if (active && state.quietStartedAt === undefined) return { ...state, quietStartedAt: now };
  if (!active && state.quietStartedAt !== undefined) {
    const delta = now - state.quietStartedAt;
    return { ...state, quietStartedAt: undefined, reminders: state.reminders.map((r) => ({ ...r, nextDueAt: r.nextDueAt + delta })) };
  }
  return state;
}
