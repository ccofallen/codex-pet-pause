export type PresetReminderType = 'lookAway' | 'drinkWater' | 'standUp' | 'takeBreak';
export type ReminderStatus = 'scheduled' | 'due' | 'snoozed' | 'disabled';

interface ReminderBase {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  nextDueAt: number;
  status: ReminderStatus;
  snoozedUntil?: number | undefined;
}

export interface PresetReminder extends ReminderBase {
  kind: 'preset';
  type: PresetReminderType;
  optionalActionDurationSeconds?: number | undefined;
}

export interface CustomReminder extends ReminderBase {
  kind: 'custom';
  label: string;
}

export type Reminder = PresetReminder | CustomReminder;
export interface DueItem { reminderId: string; dueAt: number }
export interface SchedulerState {
  reminders: Reminder[];
  dueQueue: DueItem[];
  pausedAt?: number | undefined;
  pausedUntil?: number | undefined;
  quietStartedAt?: number | undefined;
}

export const isPresetReminder = (reminder: Reminder): reminder is PresetReminder => (
  reminder.kind === 'preset'
);
