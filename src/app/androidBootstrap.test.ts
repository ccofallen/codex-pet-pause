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

  test('uses only Android-safe adapters and the shared plus Android style entry points', () => {
    expect(androidBootstrapSource).not.toMatch(
      /(?:main\.web|pwaStatus|rendererSettingsRepository|browserNotifications|browserAudio|desktop\.css|window\.petShell)/,
    );
    expect(androidBootstrapSource).toContain("import './styles/tokens.css';");
    expect(androidBootstrapSource).toContain("import './styles/global.css';");
    expect(androidBootstrapSource).toContain("import './styles/android.css';");
  });
});
