import { expect, test } from 'vitest';
import {
  CAT_COMPACT_SIZE,
  CAT_DESKTOP_SIZE,
  clampCatPosition,
  defaultCatPosition,
  placeBubble,
} from './viewport';

test('exports the fixed desktop and compact cat sizes', () => {
  expect(CAT_DESKTOP_SIZE).toEqual({ width: 140, height: 152 });
  expect(CAT_COMPACT_SIZE).toEqual({ width: 112, height: 121 });
});

test('uses the fixed top-right default and clamps small viewports', () => {
  expect(defaultCatPosition({ width: 1000, height: 700 }, { width: 140, height: 152 }))
    .toEqual({ x: 836, y: 96 });
  expect(defaultCatPosition({ width: 120, height: 100 }, { width: 140, height: 152 }))
    .toEqual({ x: 0, y: 0 });
  expect(defaultCatPosition({ width: 200, height: 200 }, { width: 140, height: 152 }))
    .toEqual({ x: 36, y: 48 });
});

test('clamps any dragged point to the visible viewport', () => {
  expect(clampCatPosition(
    { x: 900, y: -20 },
    { width: 1000, height: 700 },
    { width: 140, height: 152 },
  )).toEqual({ x: 860, y: 0 });
  expect(clampCatPosition(
    { x: -10, y: 800 },
    { width: 1000, height: 700 },
    { width: 140, height: 152 },
  )).toEqual({ x: 0, y: 548 });
  expect(clampCatPosition(
    { x: 50, y: 50 },
    { width: 100, height: 100 },
    { width: 140, height: 152 },
  )).toEqual({ x: 0, y: 0 });
});

test('chooses the least-overflow bubble side and clamps its coordinates', () => {
  expect(placeBubble(
    { x: 836, y: 96, width: 140, height: 152 },
    { width: 1000, height: 700 },
    { width: 320, height: 240 },
  )).toEqual({ side: 'left', left: 504, top: 52 });
});

test('chooses top first when multiple bubble sides share the minimum overflow', () => {
  expect(placeBubble(
    { x: 430, y: 274, width: 140, height: 152 },
    { width: 1000, height: 700 },
    { width: 200, height: 100 },
  )).toEqual({ side: 'top', left: 400, top: 162 });
});

test('clamps an oversized bubble origin into the viewport after choosing its side', () => {
  const placed = placeBubble(
    { x: 0, y: 0, width: 100, height: 80 },
    { width: 100, height: 80 },
    { width: 200, height: 150 },
  );

  expect(placed).toMatchObject({ left: 0, top: 0 });
});
