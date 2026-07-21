import { describe, expect, test } from 'vitest';
import type { PetFrameMetadata, StandardPetAnimation } from '../domain/types';
import {
  animationRows, getLookCell, isLookDirectionVisible, resolveAnimationRow, spritePosition,
} from './atlas';

function frameMetadata(
  overrides: Partial<Record<StandardPetAnimation, number[]>>,
  visibleLookDirections?: number[],
): PetFrameMetadata {
  const animationColumns = Object.fromEntries(
    Object.keys(animationRows).map((animation) => [animation, [0]]),
  ) as Record<StandardPetAnimation, number[]>;
  return {
    animationColumns: { ...animationColumns, ...overrides },
    ...(visibleLookDirections === undefined ? {} : { visibleLookDirections }),
  };
}

describe('standard Codex pet atlas metadata', () => {
  test('maps the last cell to the atlas edge for each version', () => {
    expect(spritePosition({ row: 8, column: 7 }, 1)).toEqual({ x: 100, y: 100 });
    expect(spritePosition({ row: 10, column: 7 }, 2)).toEqual({ x: 100, y: 100 });
  });

  test('maps clockwise look directions across the v2 look rows', () => {
    expect(getLookCell(0)).toEqual({ row: 9, column: 0 });
    expect(getLookCell(180)).toEqual({ row: 10, column: 0 });
  });

  test('exposes standard waving and failed rows', () => {
    expect(animationRows.waving).toMatchObject({ row: 3, frameCount: 4 });
    expect(animationRows.failed).toMatchObject({ row: 5, frameCount: 8 });
  });

  test('resolves every visible idle column from analyzed metadata', () => {
    const metadata = frameMetadata({ idle: [0, 1, 2, 3, 4, 5, 6, 7] });

    expect(resolveAnimationRow('idle', metadata).columns)
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('keeps explicit non-contiguous columns and their authored durations', () => {
    const metadata = frameMetadata({ waving: [0, 1, 3] });

    expect(resolveAnimationRow('waving', metadata)).toMatchObject({
      row: 3,
      columns: [0, 1, 3],
      durations: [180, 180, 280],
    });
  });

  test('uses regular cadence for extra frames and the ending pause only for the last frame', () => {
    const metadata = frameMetadata({ waving: [0, 3, 6, 7] });

    expect(resolveAnimationRow('waving', metadata).durations)
      .toEqual([180, 180, 180, 280]);
  });

  test('falls back from an empty animation to visible idle frames', () => {
    const metadata = frameMetadata({ idle: [1, 4], jumping: [] });

    expect(resolveAnimationRow('jumping', metadata)).toMatchObject({
      row: 0,
      columns: [1, 4],
    });
  });

  test('uses published fallback columns when frame metadata is missing', () => {
    expect(Object.fromEntries(
      Object.keys(animationRows).map((animation) => [
        animation,
        resolveAnimationRow(animation as StandardPetAnimation).columns,
      ]),
    )).toEqual({
      idle: [0, 1, 2, 3, 4, 5],
      'running-right': [0, 1, 2, 3, 4, 5, 6, 7],
      'running-left': [0, 1, 2, 3, 4, 5, 6, 7],
      waving: [0, 1, 2, 3],
      jumping: [0, 1, 2, 3, 4],
      failed: [0, 1, 2, 3, 4, 5, 6, 7],
      waiting: [0, 1, 2, 3, 4, 5],
      running: [0, 1, 2, 3, 4, 5],
      review: [0, 1, 2, 3, 4, 5],
    });
  });

  test('matches requested angles to analyzed look-direction indexes', () => {
    const metadata = frameMetadata({}, [0, 15]);

    expect(isLookDirectionVisible(0, metadata)).toBe(true);
    expect(isLookDirectionVisible(-22.5, metadata)).toBe(true);
    expect(isLookDirectionVisible(180, metadata)).toBe(false);
    expect(isLookDirectionVisible(180)).toBe(true);
  });
});
