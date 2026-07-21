import { describe, expect, test } from 'vitest';

import { catalogs, translate } from './messages';

test('keeps both catalogs complete and non-empty', () => {
  const zhCNKeys = Object.keys(catalogs['zh-CN']).sort();
  const englishKeys = Object.keys(catalogs.en).sort();

  expect(englishKeys).toEqual(zhCNKeys);
  for (const catalog of Object.values(catalogs)) {
    for (const value of Object.values(catalog)) {
      if (typeof value === 'string') expect(value).not.toBe('');
    }
  }
});

describe('translate', () => {
  test('returns localized static messages', () => {
    expect(translate('en', 'app.loading')).toBe('Waking your pet…');
    expect(translate('zh-CN', 'settings.language')).toBe('语言');
  });

  test('passes typed arguments to pluralized messages', () => {
    expect(translate('en', 'count.reminders', { count: 1 })).toBe('1 reminder');
    expect(translate('en', 'count.reminders', { count: 2 })).toBe('2 reminders');
    expect(translate('zh-CN', 'count.reminders', { count: 2 })).toBe('2 项提醒');
  });

  test('formats localized reminder notification copy', () => {
    expect(translate('en', 'reminder.notification.title')).toBe('Meow');
    expect(translate('en', 'reminder.notification.one', { label: 'drink water' }))
      .toBe('Time to drink water.');
    expect(translate('en', 'reminder.notification.many', { labels: 'drink water and stand up' }))
      .toBe('Time to drink water and stand up.');
  });
});
