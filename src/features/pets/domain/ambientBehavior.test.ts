import { describe, expect, test } from 'vitest';
import { ambientAnimation, ambientDelayMs } from './ambientBehavior';

describe('ambient Codex pet behavior', () => {
  test('maps a normalized random value to the full ambient delay range', () => {
    expect(ambientDelayMs(0)).toBe(12_000);
    expect(ambientDelayMs(1)).toBe(25_000);
  });

  test('selects each ambient animation deterministically', () => {
    expect([0, 0.25, 0.5, 0.75].map(ambientAnimation))
      .toEqual(['waving', 'jumping', 'review', 'running']);
  });

  test('clamps invalid random inputs before mapping', () => {
    expect(ambientDelayMs(-1)).toBe(12_000);
    expect(ambientDelayMs(2)).toBe(25_000);
    expect(ambientDelayMs(Number.NaN)).toBe(12_000);
    expect(ambientAnimation(Number.POSITIVE_INFINITY)).toBe('waving');
  });
});
