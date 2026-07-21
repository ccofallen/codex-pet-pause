import { describe, expect, test } from 'vitest';
import { addAffinity, getAffinityLevel } from './affinity';

describe('cat affinity', () => {
  test('adds one point and stays within the 0–100 range', () => {
    expect(addAffinity(-2)).toBe(1);
    expect(addAffinity(99)).toBe(100);
    expect(addAffinity(100)).toBe(100);
  });

  test.each([
    [0, 'new'],
    [9, 'new'],
    [10, 'familiar'],
    [29, 'familiar'],
    [30, 'close'],
    [59, 'close'],
    [60, 'best-friend'],
    [100, 'best-friend'],
  ] as const)('maps %i affinity to %s', (value, level) => {
    expect(getAffinityLevel(value)).toBe(level);
  });
});
