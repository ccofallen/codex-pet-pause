import { expect, test } from 'vitest';

import { createCustomReminder, createReminder } from './scheduler';
import {
  createReminderNotification,
  getCatReminderCopy,
  getReminderActionCopy,
  getReminderLabel,
} from './presentation';

const NOW = Date.UTC(2026, 6, 11, 9);

test('presents custom reminder names and copy', () => {
  const reminder = createCustomReminder('custom-medicine', '吃药', 30, NOW, true);
  expect(getReminderLabel(reminder)).toBe('吃药');
  expect(getReminderActionCopy(reminder)).toBe('该做“吃药”了，按舒服的节奏来。');
  expect(getCatReminderCopy(reminder)).toBe('我来提醒你：吃药。');
});

test('presents preset labels and existing action copy', () => {
  const reminder = createReminder('lookAway', 20, NOW);
  expect(getReminderLabel(reminder)).toBe('目视远方');
  expect(getReminderActionCopy(reminder)).toBe('把视线移到远处，让眼睛轻松一下。');
  expect(getCatReminderCopy(reminder)).toBe('看屏幕很久啦，要不要看看远处？');
});

test.each([
  ['lookAway', 'Look into the distance', 'Look away from the screen for a moment and let your eyes relax.', 'You have been looking at the screen for a while. Want to look into the distance?'],
  ['drinkWater', 'Drink water', 'Have a sip of water. No need to rush.', 'Would you like to have some water with me?'],
  ['standUp', 'Stand up and move', 'Stand up and move around at a pace that feels good.', 'How about getting up for a stretch?'],
  ['takeBreak', 'Take a full break', 'Step away from the screen for a while and do what feels right for you.', 'Take a break. I will wait here for you.'],
] as const)('presents the %s preset in English', (type, label, action, catPrompt) => {
  const reminder = createReminder(type, 20, NOW);
  expect(getReminderLabel(reminder, 'en')).toBe(label);
  expect(getReminderActionCopy(reminder, 'en')).toBe(action);
  expect(getCatReminderCopy(reminder, 'en')).toBe(catPrompt);
});

test('keeps a custom reminder label unchanged in English', () => {
  const reminder = createCustomReminder('custom-medicine', '服药', 30, NOW, true);
  expect(getReminderLabel(reminder, 'en')).toBe('服药');
  expect(getReminderActionCopy(reminder, 'en')).toContain('服药');
  expect(getCatReminderCopy(reminder, 'en')).toContain('服药');
});

test('creates localized singular and multiple reminder notifications', () => {
  const drinkWater = createReminder('drinkWater', 45, NOW);
  const custom = createCustomReminder('custom-medicine', '服药', 30, NOW, true);
  expect(createReminderNotification([drinkWater], 'en')).toEqual({
    title: 'Meow',
    body: 'Time to drink water.',
    tag: 'neko-pause-reminder',
  });
  expect(createReminderNotification([drinkWater, custom], 'en')).toEqual({
    title: 'Meow',
    body: 'Time to drink water and 服药.',
    tag: 'neko-pause-reminder',
  });
  expect(createReminderNotification([drinkWater], 'zh-CN')).toEqual({
    title: '喵',
    body: '该喝水了。',
    tag: 'neko-pause-reminder',
  });
});
