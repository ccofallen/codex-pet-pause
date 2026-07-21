import { describe, expect, test } from 'vitest';

import { detectPreferredLocale } from './locale';

describe('detectPreferredLocale', () => {
  test('prefers Chinese when it appears before English', () => {
    expect(detectPreferredLocale(['fr-FR', 'zh-Hant', 'en-GB'])).toBe('zh-CN');
  });

  test('uses the first supported language in preference order', () => {
    expect(detectPreferredLocale(['fr-FR', 'en-GB', 'zh-CN'])).toBe('en');
  });

  test('falls back to English for unsupported languages', () => {
    expect(detectPreferredLocale(['de-DE'])).toBe('en');
  });

  test('falls back to English when no browser languages are supplied', () => {
    expect(detectPreferredLocale([])).toBe('en');
  });
});
