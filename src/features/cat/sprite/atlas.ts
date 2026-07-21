import { spritePosition as standardSpritePosition } from '../../pets/sprite/atlas';

export type CatAnimation =
  | 'idle' | 'running-right' | 'running-left' | 'eating' | 'jumping'
  | 'picked-up' | 'waiting' | 'running' | 'review';

export interface SpriteCell { row: number; column: number }

export const animationRows: Record<CatAnimation, { row: number; durations: readonly number[] }> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  eating: { row: 3, durations: [260, 260, 280, 300, 280, 300, 320, 400] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  'picked-up': { row: 5, durations: [180, 180, 180, 180, 180, 180, 180, 180] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

export const lookDirections = Array.from({ length: 16 }, (_, index) => index * 22.5);

export { getLookCell } from '../../pets/sprite/atlas';

export function spritePosition(cell: SpriteCell): { x: number; y: number } {
  return standardSpritePosition(cell, 2);
}
