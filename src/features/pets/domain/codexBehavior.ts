import type { AmbientAnimation } from './ambientBehavior';
import type { StandardPetAnimation } from './types';

export type CodexPetMode =
  | 'idle' | 'waiting' | 'dragging' | 'working' | 'reacting' | 'ambient' | 'failed';
export type AttentionState = 'inactive' | 'armed' | 'tracking';

export interface CodexBehaviorState {
  mode: CodexPetMode;
  animation: StandardPetAnimation;
  due: boolean;
  reactionUntil: number;
  attention: AttentionState;
  attentionUntil: number;
}

export type CodexBehaviorEvent =
  | { type: 'REMINDER_CHANGED'; due: boolean }
  | { type: 'DRAG_STARTED'; facing: 'left' | 'right' }
  | { type: 'DRAG_ENDED' }
  | { type: 'PETTED'; now: number }
  | { type: 'BREAK_STARTED' }
  | { type: 'BREAK_CANCELLED' }
  | { type: 'BREAK_COMPLETED'; now: number }
  | { type: 'SNOOZED' }
  | { type: 'SKIPPED' }
  | { type: 'PET_ERROR'; now: number }
  | { type: 'REACTION_TIMEOUT'; now: number }
  | { type: 'MOTION_DISABLED' }
  | { type: 'ATTENTION_ARMED'; now: number }
  | { type: 'ATTENTION_STARTED'; now: number }
  | { type: 'ATTENTION_EXPIRED'; now: number }
  | { type: 'AMBIENT_STARTED'; animation: AmbientAnimation; until: number };

export const initialCodexBehavior: CodexBehaviorState = {
  mode: 'idle',
  animation: 'idle',
  due: false,
  reactionUntil: 0,
  attention: 'inactive',
  attentionUntil: 0,
};

const STANDARD_REACTION_MS = 900;
const FAILED_REACTION_MS = 1_200;
const ATTENTION_MS = 6_000;

export function settledCodexBehavior(
  due: boolean,
  attention: AttentionState = 'inactive',
  attentionUntil = 0,
): CodexBehaviorState {
  return due
    ? {
        mode: 'waiting', animation: 'waiting', due: true, reactionUntil: 0,
        attention: 'inactive', attentionUntil: 0,
      }
    : { ...initialCodexBehavior, attention, attentionUntil };
}

export function reduceCodexBehavior(
  state: CodexBehaviorState,
  event: CodexBehaviorEvent,
): CodexBehaviorState {
  if (event.type === 'REMINDER_CHANGED') {
    if (state.mode === 'dragging' || state.mode === 'working' || state.mode === 'failed') {
      return event.due
        ? { ...state, due: true, attention: 'inactive', attentionUntil: 0 }
        : { ...state, due: false };
    }
    if (event.due) return settledCodexBehavior(true);
    if (state.mode === 'reacting') return { ...state, due: false };
    return settledCodexBehavior(false);
  }

  if (event.type === 'PET_ERROR') {
    return {
      ...state,
      mode: 'failed',
      animation: 'failed',
      reactionUntil: event.now + FAILED_REACTION_MS,
      attention: 'inactive',
      attentionUntil: 0,
    };
  }

  if (event.type === 'REACTION_TIMEOUT') {
    if ((state.mode === 'reacting' || state.mode === 'ambient' || state.mode === 'failed')
      && event.now >= state.reactionUntil) {
      return state.mode === 'reacting' && state.attention === 'armed'
        ? settledCodexBehavior(state.due, 'armed', state.attentionUntil)
        : settledCodexBehavior(state.due);
    }
    return state;
  }

  if (event.type === 'ATTENTION_EXPIRED') {
    if (state.attention !== 'inactive' && event.now >= state.attentionUntil) {
      return settledCodexBehavior(state.due);
    }
    return state;
  }

  if (event.type === 'MOTION_DISABLED') {
    if (state.mode === 'ambient') return settledCodexBehavior(state.due);
    return { ...state, attention: 'inactive', attentionUntil: 0 };
  }
  if (state.mode === 'failed') return state;

  if (event.type === 'ATTENTION_ARMED') {
    if (state.due || (state.mode !== 'idle' && state.mode !== 'reacting')) return state;
    return { ...state, attention: 'armed', attentionUntil: event.now + ATTENTION_MS };
  }

  if (event.type === 'ATTENTION_STARTED') {
    if (state.attention !== 'armed') return state;
    return {
      ...settledCodexBehavior(false, 'tracking', event.now + ATTENTION_MS),
      animation: 'idle',
    };
  }

  if (event.type === 'AMBIENT_STARTED') {
    if (state.mode !== 'idle' || state.due || state.attention !== 'inactive') return state;
    return {
      ...state,
      mode: 'ambient',
      animation: event.animation,
      reactionUntil: event.until,
    };
  }

  if (event.type === 'DRAG_STARTED') {
    return {
      ...state,
      mode: 'dragging',
      animation: event.facing === 'left' ? 'running-left' : 'running-right',
      reactionUntil: 0,
      attention: 'inactive',
      attentionUntil: 0,
    };
  }

  if (event.type === 'DRAG_ENDED') return settledCodexBehavior(state.due);
  if (state.mode === 'dragging') return state;

  switch (event.type) {
    case 'PETTED':
      if (state.due) return settledCodexBehavior(true);
      return {
        mode: 'reacting',
        animation: 'waving',
        due: false,
        reactionUntil: event.now + STANDARD_REACTION_MS,
        attention: 'inactive',
        attentionUntil: 0,
      };
    case 'BREAK_STARTED':
      return {
        ...state, mode: 'working', animation: 'running', reactionUntil: 0,
        attention: 'inactive', attentionUntil: 0,
      };
    case 'BREAK_CANCELLED':
      return settledCodexBehavior(state.due);
    case 'BREAK_COMPLETED':
      return {
        mode: 'reacting',
        animation: 'jumping',
        due: state.due,
        reactionUntil: event.now + STANDARD_REACTION_MS,
        attention: 'inactive',
        attentionUntil: 0,
      };
    case 'SNOOZED':
    case 'SKIPPED':
      return initialCodexBehavior;
  }
}
