import { describe, expect, test } from 'vitest';
import { animationRows as standardAnimationRows } from '../../pets/sprite/atlas';
import { animationRows, getLookCell, spritePosition } from './atlas';

describe('cat atlas metadata', () => {
  test('matches the fixed v2 row contract', () => {
    expect(animationRows.idle).toEqual({ row: 0, durations: [280, 110, 110, 140, 140, 320] });
    expect(animationRows['running-right'].durations).toHaveLength(8);
    expect(animationRows.eating).toEqual({
      row: 3,
      durations: [260, 260, 280, 300, 280, 300, 320, 400],
    });
    expect(animationRows.jumping.durations).toHaveLength(5);
    expect(animationRows['picked-up']).toEqual({
      row: 5,
      durations: [180, 180, 180, 180, 180, 180, 180, 180],
    });
    expect(animationRows.waiting.durations).toHaveLength(6);
    expect(animationRows).not.toHaveProperty('waving');
    expect(animationRows).not.toHaveProperty('failed');
    expect(standardAnimationRows.waving.row).toBe(3);
    expect(standardAnimationRows.failed.row).toBe(5);
  });

  test('maps clockwise look indexes across both rows', () => {
    expect(getLookCell(0)).toEqual({ row: 9, column: 0 });
    expect(getLookCell(90)).toEqual({ row: 9, column: 4 });
    expect(getLookCell(180)).toEqual({ row: 10, column: 0 });
    expect(getLookCell(270)).toEqual({ row: 10, column: 4 });
    expect(getLookCell(337.5)).toEqual({ row: 10, column: 7 });
  });

  test('uses exact 8-by-11 background percentages', () => {
    expect(spritePosition({ row: 10, column: 7 })).toEqual({ x: 100, y: 100 });
    expect(spritePosition({ row: 0, column: 0 })).toEqual({ x: 0, y: 0 });
  });
});
