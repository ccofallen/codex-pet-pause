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

  test('returns exact localized ZIP import guidance and errors', () => {
    expect(translate('zh-CN', 'pet.import.instructions'))
      .toBe('选择一个 ZIP，或配套的 JSON 清单和 WebP 图集。');
    expect(translate('en', 'pet.import.instructions'))
      .toBe('Choose one ZIP, or a matching JSON manifest and WebP atlas.');

    const archiveErrors = [
      ['archiveSelectionMixed', '不能同时选择 ZIP 和散装文件', 'Do not mix a ZIP with loose files.'],
      ['archiveSelectionMultiple', '每次只能选择一个 ZIP', 'Choose only one ZIP at a time.'],
      ['archiveTooLarge', 'ZIP 文件不能超过 32 MiB', 'The ZIP file must be 32 MiB or smaller.'],
      ['archiveInvalid', 'ZIP 文件已损坏或格式不受支持', 'The ZIP file is damaged or unsupported.'],
      ['archiveEncrypted', '不支持加密 ZIP 文件', 'Encrypted ZIP files are not supported.'],
      ['archivePathUnsafe', 'ZIP 中包含不安全的文件路径', 'The ZIP contains an unsafe file path.'],
      ['archiveEntryLimit', 'ZIP 中的文件数量不能超过 128 个', 'The ZIP may contain at most 128 entries.'],
      ['archiveExpandedTooLarge', 'ZIP 解压后的总大小不能超过 32 MiB', 'The expanded ZIP must be 32 MiB or smaller.'],
      ['archiveFilesMissing', 'ZIP 中找不到配套的 pet.json 和 WebP 图集', 'The ZIP does not contain a matching pet.json and WebP atlas.'],
      ['archiveMultipleManifests', '一个 ZIP 只能包含一个宠物', 'A ZIP may contain only one pet.'],
      ['archiveAtlasAmbiguous', 'ZIP 中存在多个可能匹配的宠物图集', 'The ZIP contains multiple possible pet atlases.'],
    ] as const;

    for (const [key, zhCN, en] of archiveErrors) {
      expect(translate('zh-CN', `pet.import.error.${key}`)).toBe(zhCN);
      expect(translate('en', `pet.import.error.${key}`)).toBe(en);
    }
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
