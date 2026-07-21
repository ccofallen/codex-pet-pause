import { describe, expect, test } from 'vitest';
import {
  canStartChase,
  eatingDelayMs,
  initialCatBehavior,
  lookDirectionForVector,
  reduceCatBehavior,
} from './behavior';

describe('cat behavior', () => {
  test('maps bounded random values to the closed two-to-four-minute eating delay', () => {
    expect(eatingDelayMs(-1)).toBe(120_000);
    expect(eatingDelayMs(0)).toBe(120_000);
    expect(eatingDelayMs(0.5)).toBe(180_000);
    expect(eatingDelayMs(1)).toBe(240_000);
    expect(eatingDelayMs(Number.NaN)).toBe(120_000);
  });

  test('starts and finishes eating only from eligible idle state', () => {
    const eating = reduceCatBehavior(initialCatBehavior, { type: 'EATING_TIMER_ELAPSED' });
    expect(eating).toMatchObject({ mode: 'eating', due: false, restUntil: 0 });
    expect(reduceCatBehavior(eating, { type: 'PETTED', now: 100 })).toEqual(eating);
    expect(reduceCatBehavior(eating, { type: 'MOVE_STARTED', facing: 'left' })).toEqual(eating);
    expect(reduceCatBehavior(eating, { type: 'EATING_FINISHED' })).toMatchObject({ mode: 'idle' });
  });

  test('lets drag, reminders, and disabled motion interrupt eating', () => {
    const eating = reduceCatBehavior(initialCatBehavior, { type: 'EATING_TIMER_ELAPSED' });
    expect(reduceCatBehavior(eating, { type: 'DRAG_STARTED' }).mode).toBe('dragging');
    expect(reduceCatBehavior(eating, { type: 'REMINDER_CHANGED', due: true }).mode).toBe('waiting');
    expect(reduceCatBehavior(eating, { type: 'MOTION_DISABLED' }).mode).toBe('idle');
  });

  test('keeps due semantic state while dragging and returns to waiting on drop', () => {
    const due = reduceCatBehavior(initialCatBehavior, { type: 'REMINDER_CHANGED', due: true });
    const dragging = reduceCatBehavior(due, { type: 'DRAG_STARTED' });
    expect(dragging).toMatchObject({ mode: 'dragging', due: true });
    expect(reduceCatBehavior(dragging, { type: 'DRAG_ENDED', now: 100 }))
      .toMatchObject({ mode: 'waiting', due: true, restUntil: 0 });
  });

  test('preserves the dragging pose when reminder state or stale motion events arrive', () => {
    const dragging = reduceCatBehavior(initialCatBehavior, { type: 'DRAG_STARTED' });
    const dueWhileDragging = reduceCatBehavior(dragging, { type: 'REMINDER_CHANGED', due: true });

    expect(dueWhileDragging).toMatchObject({ mode: 'dragging', due: true });
    expect(reduceCatBehavior(dueWhileDragging, { type: 'MOVEMENT_FINISHED' }))
      .toMatchObject({ mode: 'dragging', due: true });
    expect(reduceCatBehavior(dueWhileDragging, { type: 'TICK', now: 99_999 }))
      .toMatchObject({ mode: 'dragging', due: true });
  });

  test('rests for twelve seconds after a normal drop', () => {
    const dragging = reduceCatBehavior(initialCatBehavior, { type: 'DRAG_STARTED' });
    const dropped = reduceCatBehavior(dragging, { type: 'DRAG_ENDED', now: 100 });
    expect(dropped).toMatchObject({ mode: 'reacting', reaction: 'dropped', restUntil: 12_100 });
    expect(reduceCatBehavior(dropped, { type: 'TICK', now: 12_099 }).mode).toBe('reacting');
    expect(reduceCatBehavior(dropped, { type: 'TICK', now: 12_100 }))
      .toMatchObject({ mode: 'idle', restUntil: 0 });
  });

  test('uses exact reaction, pounce, and chase deadlines', () => {
    const petted = reduceCatBehavior(initialCatBehavior, { type: 'PETTED', now: 100 });
    expect(petted).toMatchObject({ mode: 'reacting', reaction: 'petted', restUntil: 1_600 });
    expect(reduceCatBehavior(petted, { type: 'TICK', now: 1_599 }).mode).toBe('reacting');
    expect(reduceCatBehavior(petted, { type: 'TICK', now: 1_600 }).mode).toBe('idle');

    const chasing = reduceCatBehavior(initialCatBehavior, {
      type: 'CHASE_STARTED', facing: 'left', now: 200, cooldownMs: 20_000,
    });
    expect(chasing).toMatchObject({
      mode: 'chasing', facing: 'left', cooldownUntil: 20_200, restUntil: 3_200,
    });
    expect(reduceCatBehavior(chasing, { type: 'TICK', now: 3_199 }).mode).toBe('chasing');
    expect(reduceCatBehavior(chasing, { type: 'TICK', now: 3_200 }).mode).toBe('idle');

    const pouncing = reduceCatBehavior(chasing, { type: 'POUNCE_STARTED', now: 300 });
    expect(pouncing).toMatchObject({ mode: 'pouncing', restUntil: 1_200 });
    expect(reduceCatBehavior(pouncing, { type: 'TICK', now: 1_199 }).mode).toBe('pouncing');
    expect(reduceCatBehavior(pouncing, { type: 'TICK', now: 1_200 }).mode).toBe('idle');
  });

  test('lets due reminders override lower-priority behavior and clears them deterministically', () => {
    const reacting = reduceCatBehavior(initialCatBehavior, { type: 'COMPLETED', now: 100 });
    expect(reacting).toMatchObject({ mode: 'reacting', reaction: 'completed' });

    const waiting = reduceCatBehavior(reacting, { type: 'REMINDER_CHANGED', due: true });
    expect(waiting).toMatchObject({ mode: 'waiting', due: true, restUntil: 0 });
    expect(waiting).not.toHaveProperty('reaction');
    expect(reduceCatBehavior(waiting, { type: 'MOVE_STARTED', facing: 'left' }).mode).toBe('waiting');
    expect(reduceCatBehavior(waiting, {
      type: 'CHASE_STARTED', facing: 'left', now: 200, cooldownMs: 20_000,
    }).mode).toBe('waiting');

    expect(reduceCatBehavior(waiting, { type: 'REMINDER_CHANGED', due: false }))
      .toMatchObject({ mode: 'idle', due: false, restUntil: 0 });
  });

  test('finishes movement and disables motion according to due state', () => {
    const moving = reduceCatBehavior(initialCatBehavior, { type: 'MOVE_STARTED', facing: 'left' });
    expect(moving).toMatchObject({ mode: 'moving', facing: 'left' });
    expect(reduceCatBehavior(moving, { type: 'MOVEMENT_FINISHED' }).mode).toBe('idle');

    const dueMoving = { ...moving, due: true };
    expect(reduceCatBehavior(dueMoving, { type: 'MOVEMENT_FINISHED' }).mode).toBe('waiting');
    expect(reduceCatBehavior(moving, { type: 'MOTION_DISABLED' }).mode).toBe('idle');
    expect(reduceCatBehavior(dueMoving, { type: 'MOTION_DISABLED' }).mode).toBe('waiting');
  });

  test.each([
    [0, -100, 0], [100, -100, 45], [100, 0, 90], [100, 100, 135],
    [0, 100, 180], [-100, 100, 225], [-100, 0, 270], [-100, -100, 315],
  ])('maps vector %s,%s to %s degrees', (dx, dy, expected) => {
    expect(lookDirectionForVector(dx, dy)).toBe(expected);
  });

  test('uses a closed 24px deadzone and rounds to sixteen look directions', () => {
    expect(lookDirectionForVector(10, 10)).toBeNull();
    expect(lookDirectionForVector(0, -24)).toBeNull();
    expect(lookDirectionForVector(10, -24)).toBe(22.5);
  });

  test('accepts every chase gate exactly at its inclusive boundary', () => {
    expect(canStartChase({
      speed: 650,
      distance: 90,
      now: 100,
      cooldownUntil: 100,
      finePointer: true,
      motionAllowed: true,
      due: false,
      textEntryFocused: false,
    })).toBe(true);
    expect(canStartChase({
      speed: 650,
      distance: 420,
      now: 100,
      cooldownUntil: 100,
      finePointer: true,
      motionAllowed: true,
      due: false,
      textEntryFocused: false,
    })).toBe(true);
  });

  test.each([
    ['speed', { speed: 649, distance: 200, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: true, due: false, textEntryFocused: false }],
    ['minimum distance', { speed: 700, distance: 89, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: true, due: false, textEntryFocused: false }],
    ['maximum distance', { speed: 700, distance: 421, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: true, due: false, textEntryFocused: false }],
    ['cooldown', { speed: 700, distance: 200, now: 99, cooldownUntil: 100, finePointer: true, motionAllowed: true, due: false, textEntryFocused: false }],
    ['coarse pointer', { speed: 700, distance: 200, now: 100, cooldownUntil: 0, finePointer: false, motionAllowed: true, due: false, textEntryFocused: false }],
    ['disabled motion', { speed: 700, distance: 200, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: false, due: false, textEntryFocused: false }],
    ['due reminder', { speed: 700, distance: 200, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: true, due: true, textEntryFocused: false }],
    ['focused text entry', { speed: 700, distance: 200, now: 100, cooldownUntil: 0, finePointer: true, motionAllowed: true, due: false, textEntryFocused: true }],
  ])('rejects chase when the %s gate fails', (_gate, input) => {
    expect(canStartChase(input)).toBe(false);
  });
});
