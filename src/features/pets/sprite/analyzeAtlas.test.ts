import { describe, expect, test } from 'vitest';
import type { SpriteVersion } from '../domain/types';
import { analyzeAtlasPixels } from './analyzeAtlas';

const COLUMN_COUNT = 8;
const STANDARD_ANIMATION_ROWS = [
  ['idle', 0],
  ['running-right', 1],
  ['running-left', 2],
  ['waving', 3],
  ['jumping', 4],
  ['failed', 5],
  ['waiting', 6],
  ['running', 7],
  ['review', 8],
] as const;

function atlasWithVisibleCells(
  version: SpriteVersion,
  cells: Array<{ row: number; column: number }>,
): Uint8ClampedArray {
  const rowCount = version === 1 ? 9 : 11;
  const pixels = new Uint8ClampedArray(COLUMN_COUNT * rowCount * 4);
  for (const { row, column } of cells) {
    pixels[(row * COLUMN_COUNT + column) * 4 + 3] = 255;
  }
  return pixels;
}

describe('analyzeAtlasPixels', () => {
  test.each(STANDARD_ANIMATION_ROWS)(
    'maps standard %s animation to row %i and skips middle and trailing transparent cells',
    (animation, row) => {
      const pixels = atlasWithVisibleCells(1, [
        { row, column: 0 }, { row, column: 2 }, { row, column: 6 },
      ]);

      expect(analyzeAtlasPixels(pixels, 8, 9, 1).animationColumns[animation])
        .toEqual([0, 2, 6]);
    },
  );

  test('preserves gaps between visible animation cells', () => {
    const pixels = atlasWithVisibleCells(2, [
      { row: 3, column: 0 }, { row: 3, column: 1 }, { row: 3, column: 3 },
    ]);

    expect(analyzeAtlasPixels(pixels, 8, 11, 2).animationColumns.waving)
      .toEqual([0, 1, 3]);
  });

  test('reports direction indices from both v2 look rows', () => {
    const pixels = atlasWithVisibleCells(2, [
      { row: 9, column: 0 }, { row: 10, column: 0 }, { row: 10, column: 7 },
    ]);

    expect(analyzeAtlasPixels(pixels, 8, 11, 2).visibleLookDirections)
      .toEqual([0, 8, 15]);
  });

  test('omits look direction metadata for v1 atlases', () => {
    expect(analyzeAtlasPixels(atlasWithVisibleCells(1, []), 8, 9, 1))
      .not.toHaveProperty('visibleLookDirections');
  });

  test('scans every pixel in a 2 by 2 cell without crossing right, bottom, or adjacent boundaries', () => {
    const width = COLUMN_COUNT * 2;
    const height = 9 * 2;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const mark = (x: number, y: number): void => {
      pixels[(y * width + x) * 4 + 3] = 255;
    };
    mark(0, 0); // top-left pixel inside idle column 0
    mark(3, 1); // bottom-right pixel inside adjacent idle column 1
    mark(4, 2); // running-right row, isolated from idle
    mark(width - 1, height - 1); // atlas right/bottom boundary, review column 7

    const metadata = analyzeAtlasPixels(pixels, width, height, 1);

    expect(metadata.animationColumns.idle).toEqual([0, 1]);
    expect(metadata.animationColumns['running-right']).toEqual([2]);
    expect(metadata.animationColumns.review).toEqual([7]);
    expect(metadata.animationColumns.waving).toEqual([]);
  });
});
