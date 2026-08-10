import { describe, expect, it } from 'vitest';
import { androidPetAnimation } from './AndroidOverlayStage';

describe('androidPetAnimation', () => {
  it('uses desktop-equivalent tap animations', () => {
    expect(androidPetAnimation(false, { type: 'tap', sequence: 1 }, false)).toBe('review');
    expect(androidPetAnimation(true, { type: 'tap', sequence: 1 }, false)).toBe('waving');
  });

  it('uses picked-up and directional imported-pet drag animations', () => {
    expect(androidPetAnimation(false, { type: 'drag', sequence: 1, facing: 'left' }, false)).toBe('picked-up');
    expect(androidPetAnimation(true, { type: 'drag', sequence: 1, facing: 'left' }, false)).toBe('running-left');
    expect(androidPetAnimation(true, { type: 'drag', sequence: 2, facing: 'right' }, false)).toBe('running-right');
  });

  it('returns to waiting or idle after interaction', () => {
    expect(androidPetAnimation(false, { type: 'idle', sequence: 2 }, true)).toBe('waiting');
    expect(androidPetAnimation(true, { type: 'idle', sequence: 2 }, false)).toBe('idle');
  });
});
