export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export type BubbleSide = 'top' | 'right' | 'bottom' | 'left';

export interface BubblePlacement {
  side: BubbleSide;
  left: number;
  top: number;
}

export const CAT_DESKTOP_SIZE: Size = { width: 140, height: 152 };
export const CAT_COMPACT_SIZE: Size = { width: 112, height: 121 };

const DEFAULT_RIGHT_MARGIN = 24;
const DEFAULT_TOP = 96;
const BUBBLE_GAP = 12;

function clamp(value: number, maximum: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, maximum));
}

export function clampCatPosition(point: Point, viewport: Size, cat: Size): Point {
  return {
    x: clamp(point.x, viewport.width - cat.width),
    y: clamp(point.y, viewport.height - cat.height),
  };
}

export function defaultCatPosition(viewport: Size, cat: Size): Point {
  return clampCatPosition(
    { x: viewport.width - cat.width - DEFAULT_RIGHT_MARGIN, y: DEFAULT_TOP },
    viewport,
    cat,
  );
}

function totalOverflow(placement: BubblePlacement, viewport: Size, bubble: Size): number {
  return Math.max(0, -placement.left)
    + Math.max(0, -placement.top)
    + Math.max(0, placement.left + bubble.width - viewport.width)
    + Math.max(0, placement.top + bubble.height - viewport.height);
}

export function placeBubble(anchor: Rect, viewport: Size, bubble: Size): BubblePlacement {
  const centeredLeft = anchor.x + (anchor.width - bubble.width) / 2;
  const centeredTop = anchor.y + (anchor.height - bubble.height) / 2;
  const candidates: BubblePlacement[] = [
    { side: 'top', left: centeredLeft, top: anchor.y - BUBBLE_GAP - bubble.height },
    { side: 'right', left: anchor.x + anchor.width + BUBBLE_GAP, top: centeredTop },
    { side: 'bottom', left: centeredLeft, top: anchor.y + anchor.height + BUBBLE_GAP },
    { side: 'left', left: anchor.x - BUBBLE_GAP - bubble.width, top: centeredTop },
  ];

  let selected = candidates[0]!;
  let selectedOverflow = totalOverflow(selected, viewport, bubble);
  for (const candidate of candidates.slice(1)) {
    const overflow = totalOverflow(candidate, viewport, bubble);
    if (overflow < selectedOverflow) {
      selected = candidate;
      selectedOverflow = overflow;
    }
  }

  return {
    side: selected.side,
    left: clamp(selected.left, viewport.width - bubble.width),
    top: clamp(selected.top, viewport.height - bubble.height),
  };
}
