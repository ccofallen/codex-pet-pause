import type {
  PetFrameMetadata, SpriteVersion, StandardPetAnimation,
} from '../domain/types';

export interface SpriteCell { row: number; column: number }

export interface AnimationRow {
  row: number;
  durations: readonly number[];
  frameCount: number;
}

export interface ResolvedAnimationRow {
  row: number;
  columns: readonly number[];
  durations: readonly number[];
}

export const animationRows: Record<StandardPetAnimation, AnimationRow> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 220, 180, 320], frameCount: 8 },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220], frameCount: 8 },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220], frameCount: 8 },
  waving: { row: 3, durations: [180, 180, 180, 280], frameCount: 4 },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280], frameCount: 5 },
  failed: { row: 5, durations: [180, 180, 180, 180, 180, 180, 180, 300], frameCount: 8 },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260], frameCount: 6 },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220], frameCount: 6 },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280], frameCount: 6 },
};

const fallbackAnimationColumns: Record<StandardPetAnimation, readonly number[]> = {
  idle: [0, 1, 2, 3, 4, 5],
  'running-right': [0, 1, 2, 3, 4, 5, 6, 7],
  'running-left': [0, 1, 2, 3, 4, 5, 6, 7],
  waving: [0, 1, 2, 3],
  jumping: [0, 1, 2, 3, 4],
  failed: [0, 1, 2, 3, 4, 5, 6, 7],
  waiting: [0, 1, 2, 3, 4, 5],
  running: [0, 1, 2, 3, 4, 5],
  review: [0, 1, 2, 3, 4, 5],
};

export function resolveAnimationRow(
  animation: StandardPetAnimation,
  frameMetadata?: PetFrameMetadata,
): ResolvedAnimationRow {
  const metadataColumns = frameMetadata?.animationColumns[animation];
  if (metadataColumns?.length === 0 && animation !== 'idle') {
    return resolveAnimationRow('idle', frameMetadata);
  }

  const source = animationRows[animation];
  const columns = metadataColumns?.length
    ? metadataColumns
    : fallbackAnimationColumns[animation];
  const endingPause = source.durations[source.durations.length - 1]!;
  const regularCadence = source.durations[source.durations.length - 2] ?? endingPause;
  return {
    row: source.row,
    columns,
    durations: columns.map((column, index) => {
      if (index === columns.length - 1) return endingPause;
      return column < source.durations.length - 1
        ? source.durations[column]!
        : regularCadence;
    }),
  };
}

function getLookDirectionIndex(direction: number): number {
  const normalized = ((direction % 360) + 360) % 360;
  return Math.round(normalized / 22.5) % 16;
}

export function isLookDirectionVisible(
  direction: number,
  frameMetadata?: PetFrameMetadata,
): boolean {
  return frameMetadata?.visibleLookDirections?.includes(getLookDirectionIndex(direction)) ?? true;
}

export function getLookCell(direction: number): SpriteCell {
  const index = getLookDirectionIndex(direction);
  return index < 8 ? { row: 9, column: index } : { row: 10, column: index - 8 };
}

export function spritePosition(
  cell: SpriteCell,
  version: SpriteVersion,
): { x: number; y: number } {
  const lastRow = version === 1 ? 8 : 10;
  return { x: cell.column / 7 * 100, y: cell.row / lastRow * 100 };
}
