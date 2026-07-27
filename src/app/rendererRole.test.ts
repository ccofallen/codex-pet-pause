import { describe, expect, test } from 'vitest';
import { deriveRendererRole } from './rendererRole';

describe('deriveRendererRole', () => {
  test.each([
    ['?mode=settings', false],
    ['?hidePet=1', false],
    ['?mode=web&view=settings&hidePet=1', false],
  ])('keeps ordinary web settings route %s authoritative', (search, desktopShellAvailable) => {
    expect(deriveRendererRole(search, desktopShellAvailable)).toEqual({
      view: 'settings',
      lifecycle: 'authoritative',
    });
  });

  test('makes only Electron settings renderers passive', () => {
    expect(deriveRendererRole('?mode=web&view=settings&hidePet=1', true)).toEqual({
      view: 'settings',
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
