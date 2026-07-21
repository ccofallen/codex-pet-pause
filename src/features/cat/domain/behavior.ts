export type CatMode =
  | 'idle' | 'moving' | 'waiting' | 'dragging' | 'chasing' | 'pouncing' | 'reacting' | 'eating';
export type CatReaction = 'petted' | 'dropped' | 'completed';
export type Facing = 'left' | 'right';

export interface CatBehaviorState {
  mode: CatMode;
  due: boolean;
  facing: Facing;
  reaction?: CatReaction;
  cooldownUntil: number;
  restUntil: number;
}

export const initialCatBehavior: CatBehaviorState = {
  mode: 'idle',
  due: false,
  facing: 'right',
  cooldownUntil: 0,
  restUntil: 0,
};

export type CatBehaviorEvent =
  | { type: 'REMINDER_CHANGED'; due: boolean }
  | { type: 'DRAG_STARTED' }
  | { type: 'DRAG_ENDED'; now: number }
  | { type: 'PETTED'; now: number }
  | { type: 'MOVE_STARTED'; facing: Facing }
  | { type: 'MOVEMENT_FINISHED' }
  | { type: 'CHASE_STARTED'; facing: Facing; now: number; cooldownMs: number }
  | { type: 'POUNCE_STARTED'; now: number }
  | { type: 'COMPLETED'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'MOTION_DISABLED' }
  | { type: 'EATING_TIMER_ELAPSED' }
  | { type: 'EATING_FINISHED' };

const PETTED_DURATION_MS = 1_500;
const DROP_REST_DURATION_MS = 12_000;
const POUNCE_DURATION_MS = 900;
const CHASE_DURATION_MS = 3_000;
export const EATING_DURATION_MS = 2_400;
const EATING_MIN_DELAY_MS = 120_000;
const EATING_DELAY_RANGE_MS = 120_000;

export function eatingDelayMs(randomValue: number): number {
  const bounded = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0;
  return EATING_MIN_DELAY_MS + bounded * EATING_DELAY_RANGE_MS;
}

function settledState(state: CatBehaviorState, mode: 'idle' | 'waiting'): CatBehaviorState {
  const { reaction: _reaction, ...rest } = state;
  return { ...rest, mode, restUntil: 0 };
}

function reactionState(
  state: CatBehaviorState,
  reaction: CatReaction,
  restUntil: number,
): CatBehaviorState {
  return { ...state, mode: 'reacting', reaction, restUntil };
}

export function reduceCatBehavior(
  state: CatBehaviorState,
  event: CatBehaviorEvent,
): CatBehaviorState {
  if (event.type === 'REMINDER_CHANGED') {
    if (state.mode === 'dragging') return { ...state, due: event.due };
    if (event.due) return { ...settledState(state, 'waiting'), due: true };
    if (state.due || state.mode === 'waiting') {
      return { ...settledState(state, 'idle'), due: false };
    }
    return state;
  }

  if (event.type === 'DRAG_STARTED') {
    const { reaction: _reaction, ...rest } = state;
    return { ...rest, mode: 'dragging', restUntil: 0 };
  }

  if (event.type === 'DRAG_ENDED') {
    if (state.due) return settledState(state, 'waiting');
    return reactionState(state, 'dropped', event.now + DROP_REST_DURATION_MS);
  }

  if (state.mode === 'dragging') return state;
  if (state.due) return settledState(state, 'waiting');
  if (state.mode === 'eating') {
    if (event.type === 'EATING_FINISHED' || event.type === 'MOTION_DISABLED') {
      return settledState(state, 'idle');
    }
    return state;
  }

  switch (event.type) {
    case 'EATING_TIMER_ELAPSED':
      return state.mode === 'idle' ? { ...state, mode: 'eating', restUntil: 0 } : state;
    case 'EATING_FINISHED':
      return state;
    case 'PETTED':
      return reactionState(state, 'petted', event.now + PETTED_DURATION_MS);
    case 'MOVE_STARTED': {
      const { reaction: _reaction, ...rest } = state;
      return { ...rest, mode: 'moving', facing: event.facing, restUntil: 0 };
    }
    case 'MOVEMENT_FINISHED':
    case 'MOTION_DISABLED':
      return settledState(state, 'idle');
    case 'CHASE_STARTED': {
      const { reaction: _reaction, ...rest } = state;
      return {
        ...rest,
        mode: 'chasing',
        facing: event.facing,
        cooldownUntil: event.now + event.cooldownMs,
        restUntil: event.now + CHASE_DURATION_MS,
      };
    }
    case 'POUNCE_STARTED': {
      const { reaction: _reaction, ...rest } = state;
      return { ...rest, mode: 'pouncing', restUntil: event.now + POUNCE_DURATION_MS };
    }
    case 'COMPLETED':
      return reactionState(state, 'completed', event.now + PETTED_DURATION_MS);
    case 'TICK':
      if ((state.mode === 'reacting' || state.mode === 'chasing' || state.mode === 'pouncing')
        && event.now >= state.restUntil) {
        return settledState(state, 'idle');
      }
      return state;
  }
}

export function lookDirectionForVector(dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) <= 24) return null;
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return Math.round(degrees / 22.5) % 16 * 22.5;
}

export function canStartChase(input: {
  speed: number;
  distance: number;
  now: number;
  cooldownUntil: number;
  finePointer: boolean;
  motionAllowed: boolean;
  due: boolean;
  textEntryFocused: boolean;
}): boolean {
  return input.speed >= 650 && input.distance >= 90 && input.distance <= 420
    && input.now >= input.cooldownUntil && input.finePointer && input.motionAllowed
    && !input.due && !input.textEntryFocused;
}
