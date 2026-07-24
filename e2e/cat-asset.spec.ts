import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

type AtlasBaseline = {
  occupancy: number[][];
  protectedCells: Record<string, string>;
};

const baseline = JSON.parse(
  readFileSync(
    new URL(
      './fixtures/neko-pause-cat-atlas-baseline.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as AtlasBaseline;

test('built-in cat atlas preserves approved cells and uses brown closed-eye arcs', async ({
  page,
}) => {
  await page.goto('/');

  const result = await page.evaluate(async (protectedCells) => {
    const CELL_WIDTH = 192;
    const CELL_HEIGHT = 208;
    const COLUMNS = 8;
    const ROWS = 11;
    const CLOSED_EYE_RECTS = {
      '0/2-left': { row: 0, column: 2, x: 45, y: 48, width: 48, height: 42 },
      '0/2-right': { row: 0, column: 2, x: 99, y: 48, width: 48, height: 42 },
      '6/4-closed': { row: 6, column: 4, x: 42, y: 48, width: 52, height: 44 },
      // Source inspection places these arcs at y=94..106, not inside the
      // original y=48..89 estimate.
      '8/5-left': { row: 8, column: 5, x: 45, y: 82, width: 48, height: 42 },
      '8/5-right': { row: 8, column: 5, x: 105, y: 82, width: 48, height: 42 },
    } as const;

    const response = await fetch('/assets/cat/neko-pause-cat.webp', {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Failed to load cat atlas: ${response.status}`);
    }

    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const hexDigest = async (pixels: Uint8ClampedArray) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');

    const occupancy: number[][] = [];
    const changedProtectedCells: string[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      const occupancyRow: number[] = [];
      for (let column = 0; column < COLUMNS; column += 1) {
        const cell = context.getImageData(
          column * CELL_WIDTH,
          row * CELL_HEIGHT,
          CELL_WIDTH,
          CELL_HEIGHT,
        );
        let occupied = 0;
        for (let offset = 3; offset < cell.data.length; offset += 4) {
          if (cell.data[offset] !== 0) {
            occupied += 1;
          }
        }
        occupancyRow.push(occupied);

        const key = `${row}/${column}`;
        const approvedHash = protectedCells[key];
        if (approvedHash) {
          const computedHash = await hexDigest(cell.data);
          if (computedHash !== approvedHash) {
            changedProtectedCells.push(key);
          }
        }
      }
      occupancy.push(occupancyRow);
    }

    const isBrownArc = (red: number, green: number, blue: number, alpha: number) =>
      alpha >= 192 &&
      red >= 55 &&
      red <= 170 &&
      green >= 35 &&
      green <= 125 &&
      blue >= 20 &&
      blue <= 90 &&
      red > green &&
      green >= blue;

    const inspectClosedEye = (rect: (typeof CLOSED_EYE_RECTS)[keyof typeof CLOSED_EYE_RECTS]) => {
      const pixels = context.getImageData(
        rect.column * CELL_WIDTH + rect.x,
        rect.row * CELL_HEIGHT + rect.y,
        rect.width,
        rect.height,
      ).data;
      const brown = new Uint8Array(rect.width * rect.height);
      let lightFill = false;

      for (let index = 0; index < brown.length; index += 1) {
        const offset = index * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        const alpha = pixels[offset + 3] ?? 0;
        brown[index] = Number(isBrownArc(red, green, blue, alpha));
        lightFill ||= alpha >= 192 && red >= 205 && green >= 205 && blue >= 205;
      }

      let largestConnectedArc = 0;
      const visited = new Uint8Array(brown.length);
      for (let start = 0; start < brown.length; start += 1) {
        if (brown[start] === 0 || visited[start] === 1) {
          continue;
        }
        const stack = [start];
        visited[start] = 1;
        let connected = 0;
        while (stack.length > 0) {
          const index = stack.pop();
          if (index === undefined) {
            break;
          }
          connected += 1;
          const x = index % rect.width;
          const y = Math.floor(index / rect.width);
          const neighbors = [
            x > 0 ? index - 1 : -1,
            x + 1 < rect.width ? index + 1 : -1,
            y > 0 ? index - rect.width : -1,
            y + 1 < rect.height ? index + rect.width : -1,
          ];
          for (const neighbor of neighbors) {
            if (
              neighbor >= 0 &&
              brown[neighbor] === 1 &&
              visited[neighbor] === 0
            ) {
              visited[neighbor] = 1;
              stack.push(neighbor);
            }
          }
        }
        largestConnectedArc = Math.max(largestConnectedArc, connected);
      }

      return {
        brownArc: largestConnectedArc >= 12,
        lightFill,
      };
    };

    return {
      dimensions: { width: canvas.width, height: canvas.height },
      occupancy,
      changedProtectedCells,
      closedEyes: Object.fromEntries(
        Object.entries(CLOSED_EYE_RECTS).map(([key, rect]) => [
          key,
          inspectClosedEye(rect),
        ]),
      ),
    };
  }, baseline.protectedCells);

  expect(result.dimensions).toEqual({ width: 1536, height: 2288 });
  expect(result.occupancy).toEqual(baseline.occupancy);
  expect(result.changedProtectedCells).toEqual([]);
  expect(result.closedEyes).toEqual({
    '0/2-left': { brownArc: true, lightFill: false },
    '0/2-right': { brownArc: true, lightFill: false },
    '6/4-closed': { brownArc: true, lightFill: false },
    '8/5-left': { brownArc: true, lightFill: false },
    '8/5-right': { brownArc: true, lightFill: false },
  });
});
