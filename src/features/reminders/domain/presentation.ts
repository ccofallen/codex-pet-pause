import { translate } from '../../../i18n/messages';
import type { Locale } from '../../../i18n/types';
import type { PresetReminderType, Reminder } from './types';

export interface NotificationPayload {
  title: string;
  body: string;
  tag: 'neko-pause-reminder';
}

const presetMessageKey: Record<PresetReminderType, {
  label: 'reminder.label.lookAway' | 'reminder.label.drinkWater' | 'reminder.label.standUp' | 'reminder.label.takeBreak';
  action: 'reminder.action.lookAway' | 'reminder.action.drinkWater' | 'reminder.action.standUp' | 'reminder.action.takeBreak';
  cat: 'reminder.cat.lookAway' | 'reminder.cat.drinkWater' | 'reminder.cat.standUp' | 'reminder.cat.takeBreak';
}> = {
  lookAway: { label: 'reminder.label.lookAway', action: 'reminder.action.lookAway', cat: 'reminder.cat.lookAway' },
  drinkWater: { label: 'reminder.label.drinkWater', action: 'reminder.action.drinkWater', cat: 'reminder.cat.drinkWater' },
  standUp: { label: 'reminder.label.standUp', action: 'reminder.action.standUp', cat: 'reminder.cat.standUp' },
  takeBreak: { label: 'reminder.label.takeBreak', action: 'reminder.action.takeBreak', cat: 'reminder.cat.takeBreak' },
};

export const getReminderLabel = (reminder: Reminder, locale: Locale = 'zh-CN'): string => (
  reminder.kind === 'preset' ? translate(locale, presetMessageKey[reminder.type].label) : reminder.label
);

export const getReminderActionCopy = (reminder: Reminder, locale: Locale = 'zh-CN'): string => {
  if (reminder.kind === 'custom') return translate(locale, 'reminder.action.custom', { label: reminder.label });
  return translate(locale, presetMessageKey[reminder.type].action);
};

export const getCatReminderCopy = (reminder: Reminder, locale: Locale = 'zh-CN'): string => (
  reminder.kind === 'custom'
    ? translate(locale, 'reminder.cat.custom', { label: reminder.label })
    : translate(locale, presetMessageKey[reminder.type].cat)
);

function notificationLabel(reminder: Reminder, locale: Locale): string {
  const label = getReminderLabel(reminder, locale);
  return locale === 'en' && reminder.kind === 'preset'
    ? `${label.slice(0, 1).toLocaleLowerCase('en')}${label.slice(1)}`
    : label;
}

export function createReminderNotification(
  reminders: readonly Reminder[],
  locale: Locale,
): NotificationPayload {
  if (reminders.length === 0) throw new RangeError('A reminder notification requires at least one reminder');
  const labels = reminders.map((reminder) => notificationLabel(reminder, locale));
  const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(labels);
  return {
    title: translate(locale, 'reminder.notification.title'),
    body: reminders.length === 1
      ? translate(locale, 'reminder.notification.one', { label: list })
      : translate(locale, 'reminder.notification.many', { labels: list }),
    tag: 'neko-pause-reminder',
  };
}
