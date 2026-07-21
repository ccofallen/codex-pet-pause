import { describe, expect, test } from 'vitest';
import { initialCodexBehavior, reduceCodexBehavior } from './codexBehavior';

describe('Codex pet behavior', () => {
  test('arms v2 attention during its greeting and starts tracking only while armed', () => {
    const greeting = reduceCodexBehavior(initialCodexBehavior, { type: 'PETTED', now: 100 });
    const armed = reduceCodexBehavior(greeting, { type: 'ATTENTION_ARMED', now: 100 });
    expect(armed).toMatchObject({
      mode: 'reacting', animation: 'waving', attention: 'armed', attentionUntil: 6_100,
    });

    expect(reduceCodexBehavior(greeting, { type: 'ATTENTION_STARTED', now: 200 }))
      .toEqual(greeting);
    const tracking = reduceCodexBehavior(armed, { type: 'ATTENTION_STARTED', now: 200 });
    expect(tracking).toMatchObject({
      mode: 'idle', animation: 'idle', attention: 'tracking', attentionUntil: 6_200,
    });
    expect(reduceCodexBehavior(tracking, { type: 'ATTENTION_EXPIRED', now: 6_199 }))
      .toEqual(tracking);
    expect(reduceCodexBehavior(tracking, { type: 'ATTENTION_EXPIRED', now: 6_200 }))
      .toEqual(initialCodexBehavior);
  });

  test('higher priority transitions clear armed and tracking attention', () => {
    const armed = reduceCodexBehavior(initialCodexBehavior, {
      type: 'ATTENTION_ARMED', now: 0,
    });
    const events = [
      { type: 'REMINDER_CHANGED', due: true } as const,
      { type: 'DRAG_STARTED', facing: 'left' } as const,
      { type: 'BREAK_STARTED' } as const,
      { type: 'PET_ERROR', now: 0 } as const,
      { type: 'SKIPPED' } as const,
      { type: 'MOTION_DISABLED' } as const,
    ];
    for (const event of events) {
      expect(reduceCodexBehavior(armed, event)).toMatchObject({
        attention: 'inactive', attentionUntil: 0,
      });
    }
  });

  test('starts ambient animation only from fully idle state', () => {
    const ambient = reduceCodexBehavior(initialCodexBehavior, {
      type: 'AMBIENT_STARTED', animation: 'review', until: 800,
    });
    expect(ambient).toMatchObject({ mode: 'ambient', animation: 'review', reactionUntil: 800 });

    const busyStates = [
      reduceCodexBehavior(initialCodexBehavior, { type: 'REMINDER_CHANGED', due: true }),
      reduceCodexBehavior(initialCodexBehavior, { type: 'DRAG_STARTED', facing: 'right' }),
      reduceCodexBehavior(initialCodexBehavior, { type: 'BREAK_STARTED' }),
      reduceCodexBehavior(initialCodexBehavior, { type: 'PET_ERROR', now: 0 }),
      reduceCodexBehavior(initialCodexBehavior, { type: 'ATTENTION_ARMED', now: 0 }),
    ];
    for (const state of busyStates) {
      expect(reduceCodexBehavior(state, {
        type: 'AMBIENT_STARTED', animation: 'waving', until: 900,
      })).toEqual(state);
    }
  });

  test('maps reminder, drag, break, completion, and skip events to standard animations', () => {
    expect(reduceCodexBehavior(initialCodexBehavior, { type: 'REMINDER_CHANGED', due: true }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting' });
    expect(reduceCodexBehavior(initialCodexBehavior, { type: 'DRAG_STARTED', facing: 'left' }))
      .toMatchObject({ mode: 'dragging', animation: 'running-left' });
    expect(reduceCodexBehavior(initialCodexBehavior, { type: 'BREAK_STARTED' }))
      .toMatchObject({ mode: 'working', animation: 'running' });
    expect(reduceCodexBehavior(initialCodexBehavior, { type: 'BREAK_COMPLETED', now: 100 }))
      .toMatchObject({ mode: 'reacting', animation: 'jumping', reactionUntil: 1_000 });
    expect(reduceCodexBehavior(initialCodexBehavior, { type: 'SKIPPED' }))
      .toMatchObject({ mode: 'idle', animation: 'idle' });
  });

  test('waves for exactly 900ms after an idle click', () => {
    const waving = reduceCodexBehavior(initialCodexBehavior, { type: 'PETTED', now: 100 });
    expect(waving).toMatchObject({ mode: 'reacting', animation: 'waving', reactionUntil: 1_000 });
    expect(reduceCodexBehavior(waving, { type: 'REACTION_TIMEOUT', now: 999 })).toEqual(waving);
    expect(reduceCodexBehavior(waving, { type: 'REACTION_TIMEOUT', now: 1_000 }))
      .toEqual(initialCodexBehavior);
  });

  test('snooze and skip settle immediately without a reaction', () => {
    const waiting = reduceCodexBehavior(initialCodexBehavior, {
      type: 'REMINDER_CHANGED', due: true,
    });
    expect(reduceCodexBehavior(waiting, { type: 'SNOOZED' })).toEqual(initialCodexBehavior);
    expect(reduceCodexBehavior(waiting, { type: 'SKIPPED' })).toEqual(initialCodexBehavior);
  });

  test('shows a genuine pet error for 1200ms without losing reminder state', () => {
    const waiting = reduceCodexBehavior(initialCodexBehavior, {
      type: 'REMINDER_CHANGED', due: true,
    });
    const failed = reduceCodexBehavior(waiting, { type: 'PET_ERROR', now: 50 });
    expect(failed).toMatchObject({
      mode: 'failed', animation: 'failed', due: true, reactionUntil: 1_250,
    });
    expect(reduceCodexBehavior(failed, { type: 'REACTION_TIMEOUT', now: 1_249 })).toEqual(failed);
    expect(reduceCodexBehavior(failed, { type: 'REACTION_TIMEOUT', now: 1_250 }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true, reactionUntil: 0 });
  });

  test('lets due reminders override idle and waving but not dragging or active work', () => {
    const waving = reduceCodexBehavior(initialCodexBehavior, { type: 'PETTED', now: 0 });
    expect(reduceCodexBehavior(waving, { type: 'REMINDER_CHANGED', due: true }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true });

    const dragging = reduceCodexBehavior(initialCodexBehavior, {
      type: 'DRAG_STARTED', facing: 'right',
    });
    expect(reduceCodexBehavior(dragging, { type: 'REMINDER_CHANGED', due: true }))
      .toMatchObject({ mode: 'dragging', animation: 'running-right', due: true });

    const working = reduceCodexBehavior(initialCodexBehavior, { type: 'BREAK_STARTED' });
    expect(reduceCodexBehavior(working, { type: 'REMINDER_CHANGED', due: true }))
      .toMatchObject({ mode: 'working', animation: 'running', due: true });
  });

  test('returns to the due semantic state after drag and preserves semantics when motion is disabled', () => {
    const dragging = reduceCodexBehavior(
      { ...initialCodexBehavior, due: true },
      { type: 'DRAG_STARTED', facing: 'left' },
    );
    expect(reduceCodexBehavior(dragging, { type: 'DRAG_ENDED' }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true });

    const states = [
      initialCodexBehavior,
      reduceCodexBehavior(initialCodexBehavior, { type: 'REMINDER_CHANGED', due: true }),
      reduceCodexBehavior(initialCodexBehavior, { type: 'BREAK_STARTED' }),
    ];
    for (const state of states) {
      expect(reduceCodexBehavior(state, { type: 'MOTION_DISABLED' })).toEqual(state);
    }
  });

  test('returns a closed active action to waiting while its reminder remains due', () => {
    const working = reduceCodexBehavior(
      { ...initialCodexBehavior, due: true },
      { type: 'BREAK_STARTED' },
    );
    expect(reduceCodexBehavior(working, { type: 'BREAK_CANCELLED' }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true });
  });

  test('reacts to completion before returning to another queued reminder', () => {
    const working = reduceCodexBehavior(
      { ...initialCodexBehavior, due: true },
      { type: 'BREAK_STARTED' },
    );
    const completed = reduceCodexBehavior(working, { type: 'BREAK_COMPLETED', now: 100 });
    expect(completed).toMatchObject({ mode: 'reacting', animation: 'jumping', due: true });
    expect(reduceCodexBehavior(completed, { type: 'REACTION_TIMEOUT', now: 1_000 }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true });
  });

  test('keeps a pet error dominant through drag cleanup and new drag events', () => {
    const dragging = reduceCodexBehavior(initialCodexBehavior, {
      type: 'DRAG_STARTED', facing: 'left',
    });
    const failed = reduceCodexBehavior(dragging, { type: 'PET_ERROR', now: 100 });
    expect(failed).toMatchObject({
      mode: 'failed', animation: 'failed', due: false, reactionUntil: 1_300,
    });

    expect(reduceCodexBehavior(failed, { type: 'DRAG_ENDED' })).toEqual(failed);
    expect(reduceCodexBehavior(failed, { type: 'DRAG_STARTED', facing: 'right' })).toEqual(failed);
    expect(reduceCodexBehavior(failed, { type: 'REACTION_TIMEOUT', now: 1_299 })).toEqual(failed);
    expect(reduceCodexBehavior(failed, { type: 'REACTION_TIMEOUT', now: 1_300 }))
      .toEqual(initialCodexBehavior);
  });

  test('updates reminder state during failure and settles to waiting only at the deadline', () => {
    const failed = reduceCodexBehavior(initialCodexBehavior, { type: 'PET_ERROR', now: 10 });
    const dueFailed = reduceCodexBehavior(failed, { type: 'REMINDER_CHANGED', due: true });
    expect(dueFailed).toMatchObject({
      mode: 'failed', animation: 'failed', due: true, reactionUntil: 1_210,
    });
    expect(reduceCodexBehavior(dueFailed, { type: 'REACTION_TIMEOUT', now: 1_209 }))
      .toEqual(dueFailed);
    expect(reduceCodexBehavior(dueFailed, { type: 'REACTION_TIMEOUT', now: 1_210 }))
      .toMatchObject({ mode: 'waiting', animation: 'waiting', due: true });
  });
});
