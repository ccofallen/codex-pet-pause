import { describe, expect, test } from 'vitest';
import { deriveRendererRole } from './rendererRole';

describe('deriveRendererRole', () => {
  test('keeps an explicit standalone settings renderer authoritative on the web', () => {
    expect(deriveRendererRole('?mode=settings', false)).toEqual({
      view: 'settings',
      lifecycle: 'authoritative',
    });
  });

  test.each([
    '?hidePet=1',
    '?mode=web&view=settings&hidePet=1',
  ])('keeps the full app shell for ordinary web route %s', (search) => {
    expect(deriveRendererRole(search, false)).toEqual({
      view: 'app',
      lifecycle: 'authoritative',
    });
  });

  test('keeps the full app shell but makes the Electron settings window passive', () => {
    expect(deriveRendererRole('?mode=web&view=settings&hidePet=1', true)).toEqual({
      view: 'app',
      lifecycle: 'passive',
    });
  });

  test('gives desktop rendering precedence over hidePet and keeps it authoritative', () => {
    expect(deriveRendererRole('?mode=desktop&hidePet=1', true)).toEqual({
      view: 'desktop',
      lifecycle: 'authoritative',
    });
  });
});
