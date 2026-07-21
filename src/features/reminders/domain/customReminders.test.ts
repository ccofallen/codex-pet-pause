import { expect, test } from 'vitest';

import { createCustomReminder, createReminder } from './scheduler';
import {
  addCustomReminder, deleteCustomReminder, editCustomReminder, newCustomReminderId,
  setCustomReminderEnabled, validateCustomReminderInput,
} from './customReminders';

const NOW = Date.UTC(2026, 6, 11, 9);

test('validates trimmed labels and integer intervals', () => {
  expect(validateCustomReminderInput({ label: '  吃药  ', interval: '30' })).toEqual({
    value: { label: '吃药', intervalMinutes: 30 },
  });
  expect(validateCustomReminderInput({ label: '', interval: '30' })).toEqual({ error: 'name-required' });
  expect(validateCustomReminderInput({ label: '猫'.repeat(41), interval: '30' })).toEqual({ error: 'name-too-long' });
  expect(validateCustomReminderInput({ label: '喝水', interval: '1.5' })).toEqual({ error: 'interval-invalid' });
});

test('renames without restarting and restarts when interval changes', () => {
  const original = createCustomReminder('custom-1', '吃药', 30, NOW, true);
  const renamed = editCustomReminder([original], original.id, { label: '服药', intervalMinutes: 30 }, NOW + 5_000);
  expect(renamed[0]).toMatchObject({ id: original.id, label: '服药', nextDueAt: original.nextDueAt });

  const changed = editCustomReminder(renamed, original.id, { label: '服药', intervalMinutes: 45 }, NOW + 10_000);
  expect(changed[0]).toMatchObject({ status: 'scheduled', nextDueAt: NOW + 10_000 + 45 * 60_000, snoozedUntil: undefined });
});

test('disable and delete remove matching due queue entries', () => {
  const reminder = { ...createCustomReminder('custom-1', '吃药', 30, NOW, true), status: 'due' as const };
  const state = { reminders: [reminder], dueQueue: [{ reminderId: reminder.id, dueAt: NOW }] };
  expect(setCustomReminderEnabled(state, reminder.id, false, NOW)).toMatchObject({ dueQueue: [] });
  expect(deleteCustomReminder(state, reminder.id)).toEqual({ reminders: [], dueQueue: [] });
});

test('creates UUID-backed and sequenced fallback IDs', () => {
  expect(newCustomReminderId(NOW, () => 'uuid')).toBe('custom-uuid');
  const first = newCustomReminderId(NOW);
  const second = newCustomReminderId(NOW);
  expect(first).toMatch(/^custom-\d+-\d+$/);
  expect(second).not.toBe(first);
});

test('adds custom reminders immutably and rejects duplicates or a twenty-first item', () => {
  const reminder = createCustomReminder('custom-new', '吃药', 30, NOW, true);
  const state = { reminders: [createReminder('lookAway', 20, NOW)], dueQueue: [] };
  expect(addCustomReminder(state, reminder)).toEqual({ ...state, reminders: [...state.reminders, reminder] });
  expect(state.reminders).toHaveLength(1);
  expect(() => addCustomReminder({ reminders: [reminder], dueQueue: [] }, reminder)).toThrow(RangeError);

  const twenty = Array.from({ length: 20 }, (_, index) => createCustomReminder(`custom-${index}`, `${index}`, 30, NOW, true));
  expect(() => addCustomReminder({ reminders: twenty, dueQueue: [] }, reminder)).toThrow(RangeError);
});

test('enables from now and rejects unknown or preset IDs', () => {
  const disabled = createCustomReminder('custom-1', '吃药', 30, NOW, false);
  expect(setCustomReminderEnabled({ reminders: [disabled], dueQueue: [] }, disabled.id, true, NOW + 1_000).reminders[0])
    .toMatchObject({ enabled: true, status: 'scheduled', nextDueAt: NOW + 1_000 + 30 * 60_000 });

  const preset = createReminder('lookAway', 20, NOW);
  const state = { reminders: [preset], dueQueue: [] };
  expect(() => editCustomReminder(state.reminders, preset.id, { label: '错误', intervalMinutes: 30 }, NOW)).toThrow(RangeError);
  expect(() => deleteCustomReminder(state, 'missing')).toThrow(RangeError);
});
