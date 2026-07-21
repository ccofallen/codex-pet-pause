import type { CustomReminder, Reminder, SchedulerState } from './types';

export interface CustomReminderInput { label: string; interval: string }
export type CustomReminderValidationCode =
  | 'name-required'
  | 'name-too-long'
  | 'interval-invalid';
export type CustomReminderValidationResult =
  | { value: { label: string; intervalMinutes: number } }
  | { error: CustomReminderValidationCode };

const minute = 60_000;
const MAX_CUSTOM_REMINDERS = 20;
let fallbackSequence = 0;

export function validateCustomReminderInput(input: CustomReminderInput): CustomReminderValidationResult {
  const label = input.label.trim();
  if (Array.from(label).length < 1) return { error: 'name-required' };
  if (Array.from(label).length > 40) return { error: 'name-too-long' };
  const intervalMinutes = Number(input.interval);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 720) {
    return { error: 'interval-invalid' };
  }
  return { value: { label, intervalMinutes } };
}

export function newCustomReminderId(now: number, randomUUID?: () => string): string {
  if (randomUUID !== undefined) return `custom-${randomUUID()}`;
  fallbackSequence += 1;
  return `custom-${now}-${fallbackSequence}`;
}

export function addCustomReminder(state: SchedulerState, reminder: CustomReminder): SchedulerState {
  if (state.reminders.some((item) => item.id === reminder.id)) {
    throw new RangeError(`Duplicate reminder: ${reminder.id}`);
  }
  if (state.reminders.filter((item) => item.kind === 'custom').length >= MAX_CUSTOM_REMINDERS) {
    throw new RangeError('Too many custom reminders');
  }
  return { ...state, reminders: [...state.reminders, reminder] };
}

function customReminderIndex(reminders: readonly Reminder[], id: string): number {
  const index = reminders.findIndex((item) => item.id === id);
  if (index < 0 || reminders[index]!.kind !== 'custom') throw new RangeError(`Unknown custom reminder: ${id}`);
  return index;
}

export function editCustomReminder(
  reminders: Reminder[],
  id: string,
  input: { label: string; intervalMinutes: number },
  now: number,
): Reminder[] {
  const index = customReminderIndex(reminders, id);
  const current = reminders[index] as CustomReminder;
  const intervalChanged = current.intervalMinutes !== input.intervalMinutes;
  const edited: CustomReminder = {
    ...current,
    label: input.label,
    intervalMinutes: input.intervalMinutes,
    ...(intervalChanged && current.enabled
      ? {
          status: 'scheduled',
          nextDueAt: now + input.intervalMinutes * minute,
          snoozedUntil: undefined,
        }
      : {}),
  };
  return reminders.map((item, itemIndex) => itemIndex === index ? edited : item);
}

export function setCustomReminderEnabled(
  state: SchedulerState,
  id: string,
  enabled: boolean,
  now: number,
): SchedulerState {
  const index = customReminderIndex(state.reminders, id);
  const current = state.reminders[index] as CustomReminder;
  const reminder: CustomReminder = {
    ...current,
    enabled,
    status: enabled ? 'scheduled' : 'disabled',
    nextDueAt: enabled ? now + current.intervalMinutes * minute : current.nextDueAt,
    snoozedUntil: undefined,
  };
  return {
    ...state,
    reminders: state.reminders.map((item, itemIndex) => itemIndex === index ? reminder : item),
    dueQueue: state.dueQueue.filter((item) => item.reminderId !== id),
  };
}

export function deleteCustomReminder(state: SchedulerState, id: string): SchedulerState {
  customReminderIndex(state.reminders, id);
  return {
    ...state,
    reminders: state.reminders.filter((item) => item.id !== id),
    dueQueue: state.dueQueue.filter((item) => item.reminderId !== id),
  };
}
