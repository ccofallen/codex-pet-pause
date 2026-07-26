import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppSnapshot } from '../../../app/AppProvider';
import {
  canStartChase,
  EATING_DURATION_MS,
  eatingDelayMs,
  initialCatBehavior,
  lookDirectionForVector,
  reduceCatBehavior,
  type CatBehaviorEvent,
  type CatBehaviorState,
} from '../domain/behavior';
import { CatSprite } from '../sprite/CatSprite';
import type { CatAnimation } from '../sprite/atlas';
import { useReducedMotion } from '../sprite/useReducedMotion';
import {
  CAT_COMPACT_SIZE,
  CAT_DESKTOP_SIZE,
  clampCatPosition,
  defaultCatPosition,
  type Point,
  type Size,
} from '../stage/viewport';
import { CatReminderBubble } from './CatReminderBubble';
import { useI18n } from '../../../i18n/I18nProvider';

export interface CatStageRuntime {
  now(): number;
  random(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const browserRuntime: CatStageRuntime = {
  now: () => Date.now(),
  random: () => Math.random(),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
};

interface InteractiveCatStageProps {
  runtime?: CatStageRuntime;
}

interface PointerSession {
  pointerId: number;
  origin: Point;
  start: Point;
  element: HTMLButtonElement;
  dragging: boolean;
  captured: boolean;
  dragWindow: boolean;
  windowOrigin: Point;
  pointerOrigin: Point;
}

interface PointerSample extends Point {
  time: number;
}

const DRAG_THRESHOLD = 6;
const WANDER_MIN_MS = 8_000;
const WANDER_RANGE_MS = 10_000;
const WANDER_DURATION_MS = 2_400;
const CHASE_COOLDOWN_MIN_MS = 20_000;
const CHASE_COOLDOWN_RANGE_MS = 20_000;
const CHASE_SPEED_PX_PER_SECOND = 480;
const CHASE_POUNCE_DISTANCE = 90;
const MAX_CHASE_FRAME_MS = 100;

function boundedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function catSizeForViewport(width: number): Size {
  return width < 480 ? CAT_COMPACT_SIZE : CAT_DESKTOP_SIZE;
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function isTextEntry(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches('textarea, [contenteditable]:not([contenteditable="false"])')) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']
    .includes(element.type);
}

function animationFor(state: CatBehaviorState): CatAnimation {
  if (state.mode === 'dragging') return 'picked-up';
  if (state.mode === 'eating') return 'eating';
  if (state.mode === 'waiting') return 'waiting';
  if (state.mode === 'pouncing') return 'jumping';
  if (state.mode === 'moving' || state.mode === 'chasing') {
    return state.facing === 'left' ? 'running-left' : 'running-right';
  }
  if (state.mode === 'reacting' && state.reaction === 'completed') return 'jumping';
  if (state.mode === 'reacting' && state.reaction === 'petted') return 'review';
  return 'idle';
}

export function InteractiveCatStage({ runtime = browserRuntime }: InteractiveCatStageProps) {
  const snapshot = useAppSnapshot();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const motionAllowed = snapshot.settings.animationsEnabled && !reducedMotion;
  const [catSize, setCatSize] = useState(() => catSizeForViewport(window.innerWidth));
  const catSizeRef = useRef(catSize);
  const [position, setPosition] = useState(() => (
    defaultCatPosition(viewportSize(), catSizeForViewport(window.innerWidth))
  ));
  const positionRef = useRef(position);
  const [behavior, setBehavior] = useState(initialCatBehavior);
  const behaviorRef = useRef(behavior);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const bubbleOpenRef = useRef(false);
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const [textEntryFocused, setTextEntryFocused] = useState(false);
  const textEntryFocusedRef = useRef(false);
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  const transitionEnabledRef = useRef(false);
  const catRef = useRef<HTMLButtonElement>(null);
  const pointerSessionRef = useRef<PointerSession | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const latestPointerRef = useRef<PointerSample | undefined>(undefined);
  const previousPointerRef = useRef<PointerSample | undefined>(undefined);
  const pendingFrameRef = useRef<number | undefined>(undefined);
  const chaseFrameTimeRef = useRef<number | undefined>(undefined);
  const pouncedThisChaseRef = useRef(false);
  const handledIntentEventIdRef = useRef<string | undefined>(undefined);
  const eatingDeadlineRef = useRef<number | undefined>(undefined);
  const eatAfterMovementRef = useRef(false);
  const due = snapshot.scheduler.dueQueue.length > 0;
  const finePointer = typeof window.matchMedia !== 'function'
    || window.matchMedia('(pointer: fine)').matches;

  const dispatchBehavior = useCallback((event: CatBehaviorEvent) => {
    setBehavior((current) => {
      const next = reduceCatBehavior(current, event);
      behaviorRef.current = next;
      return next;
    });
  }, []);

  const updatePosition = useCallback((next: Point) => {
    const clamped = clampCatPosition(next, viewportSize(), catSizeRef.current);
    positionRef.current = clamped;
    setPosition(clamped);
  }, []);

  const setStageTransition = useCallback((enabled: boolean) => {
    transitionEnabledRef.current = enabled;
    setTransitionEnabled(enabled);
  }, []);

  const freezeAutonomousMovement = useCallback((): Point | undefined => {
    if (!transitionEnabledRef.current || behaviorRef.current.mode !== 'moving') return undefined;
    const bounds = catRef.current?.getBoundingClientRect();
    setStageTransition(false);
    if (bounds === undefined || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top)) {
      return positionRef.current;
    }
    const rendered = clampCatPosition(
      { x: bounds.left, y: bounds.top },
      viewportSize(),
      catSizeRef.current,
    );
    positionRef.current = rendered;
    setPosition(rendered);
    return rendered;
  }, [setStageTransition]);

  const updateBubbleOpen = useCallback((open: boolean) => {
    bubbleOpenRef.current = open;
    setBubbleOpen(open);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const nextSize = catSizeForViewport(window.innerWidth);
      catSizeRef.current = nextSize;
      setCatSize(nextSize);
      updatePosition(positionRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updatePosition]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const focused = isTextEntry(event.target);
      textEntryFocusedRef.current = focused;
      setTextEntryFocused(focused);
    };
    const onFocusOut = (event: FocusEvent) => {
      const focused = isTextEntry(event.relatedTarget);
      textEntryFocusedRef.current = focused;
      setTextEntryFocused(focused);
    };
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (due) freezeAutonomousMovement();
    dispatchBehavior({ type: 'REMINDER_CHANGED', due });
    const completionId = snapshot.catIntentEventId;
    const hasNewCompletion = completionId !== undefined && completionId.length > 0
      && handledIntentEventIdRef.current !== completionId;
    if (!due && !(bubbleOpenRef.current && hasNewCompletion)) updateBubbleOpen(false);
  }, [dispatchBehavior, due, freezeAutonomousMovement, snapshot.catIntentEventId, updateBubbleOpen]);

  useEffect(() => {
    const eventId = snapshot.catIntentEventId;
    if (eventId === undefined || eventId.length === 0 || handledIntentEventIdRef.current === eventId) {
      return;
    }
    handledIntentEventIdRef.current = eventId;
    if (!due) {
      freezeAutonomousMovement();
      dispatchBehavior({ type: 'COMPLETED', now: runtime.now() });
    }
  }, [dispatchBehavior, due, freezeAutonomousMovement, runtime, snapshot.catIntentEventId]);

  useLayoutEffect(() => {
    if (motionAllowed) return;
    freezeAutonomousMovement();
    setLookDirection(null);
    setStageTransition(false);
    dispatchBehavior({ type: 'MOTION_DISABLED' });
  }, [dispatchBehavior, freezeAutonomousMovement, motionAllowed, setStageTransition]);

  useEffect(() => {
    if (behavior.mode !== 'reacting' && behavior.mode !== 'chasing' && behavior.mode !== 'pouncing') {
      return undefined;
    }
    const delay = Math.max(0, behavior.restUntil - runtime.now());
    const timeout = window.setTimeout(() => {
      dispatchBehavior({ type: 'TICK', now: runtime.now() });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, behavior.restUntil, dispatchBehavior, runtime]);

  useEffect(() => {
    if (behavior.mode !== 'moving') return undefined;
    const timeout = window.setTimeout(() => {
      setStageTransition(false);
      dispatchBehavior({ type: 'MOVEMENT_FINISHED' });
    }, WANDER_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, dispatchBehavior, setStageTransition]);

  useEffect(() => {
    const eligibleMode = behavior.mode === 'idle' || behavior.mode === 'moving';
    const eligible = motionAllowed && !due && !bubbleOpen && !textEntryFocused && eligibleMode;
    if (!eligible) {
      eatingDeadlineRef.current = undefined;
      eatAfterMovementRef.current = false;
      return undefined;
    }
    if (eatAfterMovementRef.current && behavior.mode === 'idle') {
      eatAfterMovementRef.current = false;
      dispatchBehavior({ type: 'EATING_TIMER_ELAPSED' });
      return undefined;
    }
    eatingDeadlineRef.current ??= runtime.now() + eatingDelayMs(runtime.random());
    const delay = Math.max(0, eatingDeadlineRef.current - runtime.now());
    const timeout = window.setTimeout(() => {
      eatingDeadlineRef.current = undefined;
      if (behaviorRef.current.mode === 'moving') {
        eatAfterMovementRef.current = true;
        return;
      }
      if (behaviorRef.current.mode === 'idle') {
        dispatchBehavior({ type: 'EATING_TIMER_ELAPSED' });
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, bubbleOpen, dispatchBehavior, due, motionAllowed, runtime, textEntryFocused]);

  useEffect(() => {
    if (behavior.mode !== 'eating') return undefined;
    const timeout = window.setTimeout(() => {
      dispatchBehavior({ type: 'EATING_FINISHED' });
    }, EATING_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, dispatchBehavior]);

  useEffect(() => {
    const canWander = motionAllowed && !due && behavior.mode === 'idle'
      && !bubbleOpen && !textEntryFocused;
    if (!canWander) return undefined;
    const delay = WANDER_MIN_MS + boundedRandom(runtime.random) * WANDER_RANGE_MS;
    const timeout = window.setTimeout(() => {
      if (behaviorRef.current.mode !== 'idle'
        || behaviorRef.current.due
        || bubbleOpenRef.current
        || textEntryFocusedRef.current) return;
      const viewport = viewportSize();
      const size = catSizeRef.current;
      const target = clampCatPosition({
        x: boundedRandom(runtime.random) * Math.max(0, viewport.width - size.width),
        y: boundedRandom(runtime.random) * Math.max(0, viewport.height - size.height),
      }, viewport, size);
      const facing = target.x < positionRef.current.x ? 'left' : 'right';
      setStageTransition(true);
      updatePosition(target);
      dispatchBehavior({ type: 'MOVE_STARTED', facing });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, bubbleOpen, dispatchBehavior, due, motionAllowed, runtime, setStageTransition, textEntryFocused, updatePosition]);

  useEffect(() => {
    if (!motionAllowed || !finePointer) return undefined;

    const scheduleFrame = () => {
      if (pendingFrameRef.current !== undefined) return;
      pendingFrameRef.current = runtime.requestFrame(processPointer);
    };

    const processPointer = () => {
      pendingFrameRef.current = undefined;
      const sample = latestPointerRef.current;
      if (sample === undefined) return;
      const previous = previousPointerRef.current;
      previousPointerRef.current = sample;
      const center = {
        x: positionRef.current.x + catSizeRef.current.width / 2,
        y: positionRef.current.y + catSizeRef.current.height / 2,
      };
      const dx = sample.x - center.x;
      const dy = sample.y - center.y;
      const distance = Math.hypot(dx, dy);
      setLookDirection(lookDirectionForVector(dx, dy));

      const elapsed = previous === undefined ? 0 : Math.max(1, sample.time - previous.time);
      const speed = previous === undefined
        ? 0
        : Math.hypot(sample.x - previous.x, sample.y - previous.y) / elapsed * 1_000;
      const current = behaviorRef.current;

      if (current.mode === 'chasing') {
        const now = runtime.now();
        if (distance <= CHASE_POUNCE_DISTANCE && !pouncedThisChaseRef.current) {
          pouncedThisChaseRef.current = true;
          chaseFrameTimeRef.current = undefined;
          dispatchBehavior({ type: 'POUNCE_STARTED', now });
        } else if (distance > CHASE_POUNCE_DISTANCE) {
          const previousFrameTime = chaseFrameTimeRef.current ?? now;
          const elapsed = Math.min(MAX_CHASE_FRAME_MS, Math.max(0, now - previousFrameTime));
          chaseFrameTimeRef.current = now;
          const travel = Math.min(
            distance - CHASE_POUNCE_DISTANCE,
            CHASE_SPEED_PX_PER_SECOND * elapsed / 1_000,
          );
          updatePosition({
            x: positionRef.current.x + dx / distance * travel,
            y: positionRef.current.y + dy / distance * travel,
          });
          scheduleFrame();
        }
        return;
      }

      if (current.mode !== 'idle' || bubbleOpenRef.current) return;
      if (!canStartChase({
        speed,
        distance,
        now: sample.time,
        cooldownUntil: current.cooldownUntil,
        finePointer,
        motionAllowed,
        due: current.due,
        textEntryFocused: textEntryFocusedRef.current,
      })) return;

      pouncedThisChaseRef.current = false;
      chaseFrameTimeRef.current = sample.time;
      dispatchBehavior({
        type: 'CHASE_STARTED',
        facing: dx < 0 ? 'left' : 'right',
        now: sample.time,
        cooldownMs: CHASE_COOLDOWN_MIN_MS
          + boundedRandom(runtime.random) * CHASE_COOLDOWN_RANGE_MS,
      });
      scheduleFrame();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== '' && event.pointerType !== 'mouse') return;
      latestPointerRef.current = { x: event.clientX, y: event.clientY, time: runtime.now() };
      scheduleFrame();
    };

    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (pendingFrameRef.current !== undefined) {
        runtime.cancelFrame(pendingFrameRef.current);
        pendingFrameRef.current = undefined;
      }
    };
  }, [dispatchBehavior, finePointer, motionAllowed, runtime, updatePosition]);

  useEffect(() => () => {
    const session = pointerSessionRef.current;
    pointerSessionRef.current = undefined;
    suppressClickRef.current = false;
    if (session?.captured) {
      try {
        session.element.releasePointerCapture(session.pointerId);
      } catch {
        // The browser may already have released capture while unmounting.
      }
    }
  }, []);

  const releaseCapture = (session: PointerSession) => {
    if (!session.captured) return;
    try {
      session.element.releasePointerCapture(session.pointerId);
    } catch {
      // Capture can be released automatically before an explicit release.
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (pointerSessionRef.current !== undefined) return;
    suppressClickRef.current = false;
    if (bubbleOpenRef.current) event.preventDefault();
    const windowOrigin = { x: event.screenX - event.clientX, y: event.screenY - event.clientY };
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      start: positionRef.current,
      element: event.currentTarget,
      dragging: false,
      captured: false,
      dragWindow: typeof window.petShell?.dragWindowTo === 'function',
      windowOrigin,
      pointerOrigin: { x: event.screenX, y: event.screenY },
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.origin.x;
    const dy = event.clientY - session.origin.y;
    if (!session.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      const renderedStart = freezeAutonomousMovement();
      if (renderedStart !== undefined) session.start = renderedStart;
      else setStageTransition(false);
      session.dragging = true;
      dispatchBehavior({ type: 'DRAG_STARTED' });
      try {
        session.element.setPointerCapture(session.pointerId);
        session.captured = true;
      } catch {
        // Dragging still works while the pointer remains over the button.
      }
    }
    if (!session.dragging) return;
    if (session.dragWindow && typeof window.petShell?.dragWindowTo === 'function') {
      window.petShell.dragWindowTo(
        session.windowOrigin.x + event.screenX - session.pointerOrigin.x,
        session.windowOrigin.y + event.screenY - session.pointerOrigin.y,
      );
      return;
    }
    updatePosition({ x: session.start.x + dx, y: session.start.y + dy });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    suppressClickRef.current = true;
    pointerSessionRef.current = undefined;
    if (session.dragging) {
      releaseCapture(session);
      dispatchBehavior({ type: 'DRAG_ENDED', now: runtime.now() });
    } else {
      freezeAutonomousMovement();
      if (behaviorRef.current.due) updateBubbleOpen(true);
      else dispatchBehavior({ type: 'PETTED', now: runtime.now() });
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    pointerSessionRef.current = undefined;
    suppressClickRef.current = false;
    if (!session.dragging) return;
    releaseCapture(session);
    dispatchBehavior({ type: 'DRAG_ENDED', now: runtime.now() });
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    pointerSessionRef.current = undefined;
    suppressClickRef.current = true;
    if (session.dragging) dispatchBehavior({ type: 'DRAG_ENDED', now: runtime.now() });
  };

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current && event.detail > 0) {
      suppressClickRef.current = false;
      return;
    }
    freezeAutonomousMovement();
    if (behaviorRef.current.due) updateBubbleOpen(true);
    else dispatchBehavior({ type: 'PETTED', now: runtime.now() });
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    window.petShell?.showContextMenu?.(event.screenX, event.screenY);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keyboardDelta = event.shiftKey ? 80 : 20;
    const delta = {
      ArrowLeft: { x: -keyboardDelta, y: 0 },
      ArrowRight: { x: keyboardDelta, y: 0 },
      ArrowUp: { x: 0, y: -keyboardDelta },
      ArrowDown: { x: 0, y: keyboardDelta },
    }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    freezeAutonomousMovement();
    setStageTransition(false);
    updatePosition({ x: positionRef.current.x + delta.x, y: positionRef.current.y + delta.y });
    dispatchBehavior({ type: 'DRAG_ENDED', now: runtime.now() });
  };

  const anchor = useMemo(() => ({
    x: position.x,
    y: position.y,
    width: catSize.width,
    height: catSize.height,
  }), [catSize.height, catSize.width, position.x, position.y]);
  const transition = transitionEnabled
    ? 'transform 2400ms cubic-bezier(.3,.8,.3,1)'
    : 'none';

  return (
    <>
      <button
        ref={catRef}
        type="button"
        className="interactive-cat-button"
        data-testid="cat-stage"
        data-mode={behavior.mode}
        data-reaction={behavior.reaction}
        data-cooldown-until={behavior.cooldownUntil}
        aria-label={due
          ? t('pet.openReminder', { name: snapshot.settings.cat.name })
          : t('pet.touch', { name: snapshot.settings.cat.name })}
        style={{
          position: 'fixed',
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          transition,
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <CatSprite
          animation={animationFor(behavior)}
          lookDirection={behavior.mode === 'idle' ? lookDirection : null}
          animate={motionAllowed}
        />
      </button>
      <CatReminderBubble
        open={bubbleOpen}
        anchor={anchor}
        returnFocusRef={catRef}
        onRequestClose={() => updateBubbleOpen(false)}
      />
    </>
  );
}
