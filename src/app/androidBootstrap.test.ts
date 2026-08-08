import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { selectBootstrap } from './bootstrapHost';

const androidBootstrapSource = readFileSync('src/main.android.tsx', 'utf8');

describe('selectBootstrap', () => {
  test('selects Android only for the explicit Android build host', () => {
    expect(selectBootstrap('android')).toBe('android');
    expect(selectBootstrap('desktop')).toBe('web');
    expect(selectBootstrap(undefined)).toBe('web');
  });

  test('does not import the web bootstrap, PWA, browser adapters, or web CSS', () => {
    expect(androidBootstrapSource).not.toMatch(
      /(?:main\.web|pwaStatus|rendererSettingsRepository|browserNotifications|browserAudio|historyRepository|petRepository|styles\/)/,
    );
  });
});
