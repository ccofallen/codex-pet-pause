import { describe, expect, it } from 'vitest';
import { resolvePetWindowPolicy } from './window-policy.js';

describe('pet window platform policy', () => {
  it('makes the Linux pet non-focusable so it follows every workspace', () => {
    expect(resolvePetWindowPolicy('linux')).toEqual({ focusable: false });
  });

  it.each(['darwin', 'win32'])('keeps the %s pet focusable', (platform) => {
    expect(resolvePetWindowPolicy(platform)).toEqual({ focusable: true });
  });
});
