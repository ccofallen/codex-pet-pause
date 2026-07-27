import { describe, expect, it } from 'vitest';
import { resolvePetWindowPolicy } from './window-policy.js';

describe('pet window platform policy', () => {
  it('makes the Linux pet non-focusable so it follows every workspace', () => {
    expect(resolvePetWindowPolicy('linux')).toEqual({ focusable: false });
  });

  it('makes the Windows pet non-focusable so changing focus cannot expose a title bar', () => {
    expect(resolvePetWindowPolicy('win32')).toEqual({ focusable: false });
  });

  it('keeps the macOS pet focusable', () => {
    expect(resolvePetWindowPolicy('darwin')).toEqual({ focusable: true });
  });
});
