import type {
  PetFrameMetadata, SpriteVersion, StandardPetAnimation,
} from '../domain/types';
import { animationRows } from './atlas';

const COLUMN_COUNT = 8;

function cellHasVisiblePixel(
  data: Uint8ClampedArray,
  width: number,
  cellWidth: number,
  cellHeight: number,
  row: number,
  column: number,
): boolean {
  const startX = column * cellWidth;
  const startY = row * cellHeight;
  for (let y = startY; y < startY + cellHeight; y += 1) {
    for (let x = startX; x < startX + cellWidth; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) return true;
    }
  }
  return false;
}

export function analyzeAtlasPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  version: SpriteVersion,
): PetFrameMetadata {
  const rowCount = version === 1 ? 9 : 11;
  const cellWidth = width / COLUMN_COUNT;
  const cellHeight = height / rowCount;
  const animationColumns = {} as Record<StandardPetAnimation, number[]>;

  for (const [animation, { row }] of Object.entries(animationRows) as Array<
    [StandardPetAnimation, { row: number }]
  >) {
    animationColumns[animation] = Array.from({ length: COLUMN_COUNT }, (_, column) => column)
      .filter((column) => cellHasVisiblePixel(
        data, width, cellWidth, cellHeight, row, column,
      ));
  }

  if (version === 1) return { animationColumns };

  const visibleLookDirections = Array.from({ length: 16 }, (_, direction) => direction)
    .filter((direction) => cellHasVisiblePixel(
      data,
      width,
      cellWidth,
      cellHeight,
      direction < 8 ? 9 : 10,
      direction % 8,
    ));
  return { animationColumns, visibleLookDirections };
}
