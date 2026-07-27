import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAppController, useAppSnapshot } from '../../../app/AppProvider';
import { CatReminderBubble } from '../../cat/components/CatReminderBubble';
import { lookDirectionForVector } from '../../cat/domain/behavior';
import { useReducedMotion } from '../../cat/sprite/useReducedMotion';
import {
  CAT_COMPACT_SIZE,
  CAT_DESKTOP_SIZE,
  clampCatPosition,
  type Point,
  type Size,
} from '../../cat/stage/viewport';
import {
  initialCodexBehavior,
  reduceCodexBehavior,
  settledCodexBehavior,
  type CodexBehaviorEvent,
  type CodexBehaviorState,
} from '../domain/codexBehavior';
import { ambientAnimation, ambientDelayMs } from '../domain/ambientBehavior';
import type { StoredCodexPet } from '../domain/types';
import { resolveAnimationRow } from '../sprite/atlas';
import { PetSprite } from '../sprite/PetSprite';
import { useI18n } from '../../../i18n/I18nProvider';

export interface CodexPetStageProps {
  pet: StoredCodexPet;
  random?: () => number;
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

const DRAG_THRESHOLD = 6;
const ATTENTION_DEPARTURE_PX = 48;

function petSizeForViewport(width: number): Size {
  return width < 480 ? CAT_COMPACT_SIZE : CAT_DESKTOP_SIZE;
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function positionFromRatios(ratios: { xRatio: number; yRatio: number }, size: Size): Point {
  const viewport = viewportSize();
  return clampCatPosition({
    x: Math.max(0, viewport.width - size.width) * ratios.xRatio,
    y: Math.max(0, viewport.height - size.height) * ratios.yRatio,
  }, viewport, size);
}

export function CodexPetStage({ pet, random = Math.random }: CodexPetStageProps) {
  const snapshot = useAppSnapshot();
  const controller = useAppController();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const motionAllowed = snapshot.settings.animationsEnabled && !reducedMotion;
  const [petSize, setPetSize] = useState(() => petSizeForViewport(window.innerWidth));
  const petSizeRef = useRef(petSize);
  const [position, setPosition] = useState(() => (
    positionFromRatios(snapshot.settings.petPosition, petSizeForViewport(window.innerWidth))
  ));
  const positionRef = useRef(position);
  const [behavior, setBehavior] = useState<CodexBehaviorState>(initialCodexBehavior);
  const behaviorRef = useRef(behavior);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const petRef = useRef<HTMLButtonElement>(null);
  const pointerSessionRef = useRef<PointerSession | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const handledIntentEventIdRef = useRef(snapshot.catIntentEventId);
  const previousLibraryErrorRef = useRef(snapshot.petLibraryError);
  const petIdRef = useRef(pet.id);
  const [atlas, setAtlas] = useState<{ blob: Blob; url: string }>();
  const due = snapshot.scheduler.dueQueue.length > 0;
  const finePointer = typeof window.matchMedia !== 'function'
    || window.matchMedia('(pointer: fine)').matches;

  const dispatchBehavior = useCallback((event: CodexBehaviorEvent) => {
    setBehavior((current) => {
      const next = reduceCodexBehavior(current, event);
      behaviorRef.current = next;
      return next;
    });
  }, []);

  const updatePosition = useCallback((next: Point) => {
    const clamped = clampCatPosition(next, viewportSize(), petSizeRef.current);
    positionRef.current = clamped;
    setPosition(clamped);
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(pet.spritesheet);
    setAtlas({ blob: pet.spritesheet, url });
    return () => URL.revokeObjectURL(url);
  }, [pet.spritesheet]);

  useEffect(() => {
    if (petIdRef.current === pet.id) return;
    petIdRef.current = pet.id;
    const settled = settledCodexBehavior(due);
    behaviorRef.current = settled;
    setBehavior(settled);
    setLookDirection(null);
  }, [due, pet.id]);

  useEffect(() => {
    const onResize = () => {
      const nextSize = petSizeForViewport(window.innerWidth);
      petSizeRef.current = nextSize;
      setPetSize(nextSize);
      updatePosition(positionRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updatePosition]);

  useEffect(() => {
    dispatchBehavior({ type: 'REMINDER_CHANGED', due });
    if (!due && behaviorRef.current.mode !== 'working') setBubbleOpen(false);
  }, [dispatchBehavior, due]);

  useEffect(() => {
    const eventId = snapshot.catIntentEventId;
    if (eventId === undefined || eventId.length === 0 || handledIntentEventIdRef.current === eventId) {
      return;
    }
    handledIntentEventIdRef.current = eventId;
    dispatchBehavior({ type: 'BREAK_COMPLETED', now: Date.now() });
  }, [dispatchBehavior, snapshot.catIntentEventId]);

  useEffect(() => {
    const previous = previousLibraryErrorRef.current;
    previousLibraryErrorRef.current = snapshot.petLibraryError;
    if (snapshot.petLibraryError === 'write-failed' && previous !== 'write-failed') {
      dispatchBehavior({ type: 'PET_ERROR', now: Date.now() });
    }
  }, [dispatchBehavior, snapshot.petLibraryError]);

  useEffect(() => {
    if (behavior.mode !== 'reacting'
      && behavior.mode !== 'ambient'
      && behavior.mode !== 'failed') return undefined;
    const timeout = window.setTimeout(() => {
      dispatchBehavior({ type: 'REACTION_TIMEOUT', now: Date.now() });
    }, Math.max(0, behavior.reactionUntil - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [behavior.mode, behavior.reactionUntil, dispatchBehavior]);

  useEffect(() => {
    if (behavior.attention === 'inactive') return undefined;
    const timeout = window.setTimeout(() => {
      dispatchBehavior({ type: 'ATTENTION_EXPIRED', now: Date.now() });
    }, Math.max(0, behavior.attentionUntil - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [behavior.attention, behavior.attentionUntil, dispatchBehavior]);

  useEffect(() => {
    if (pet.spriteVersion !== 2
      || behavior.attention === 'inactive'
      || !finePointer
      || !motionAllowed) {
      setLookDirection(null);
      return undefined;
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== '' && event.pointerType !== 'mouse') return;
      if (behaviorRef.current.attention === 'armed') {
        const position = positionRef.current;
        const size = petSizeRef.current;
        const outsideDepartureBoundary = event.clientX < position.x - ATTENTION_DEPARTURE_PX
          || event.clientX > position.x + size.width + ATTENTION_DEPARTURE_PX
          || event.clientY < position.y - ATTENTION_DEPARTURE_PX
          || event.clientY > position.y + size.height + ATTENTION_DEPARTURE_PX;
        if (!outsideDepartureBoundary) return;
        dispatchBehavior({ type: 'ATTENTION_STARTED', now: Date.now() });
      }
      const center = {
        x: positionRef.current.x + petSizeRef.current.width / 2,
        y: positionRef.current.y + petSizeRef.current.height / 2,
      };
      setLookDirection(lookDirectionForVector(event.clientX - center.x, event.clientY - center.y));
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [behavior.attention, dispatchBehavior, finePointer, motionAllowed, pet.spriteVersion]);

  useEffect(() => {
    if (behavior.mode !== 'idle'
      || behavior.attention !== 'inactive'
      || due
      || !motionAllowed) return undefined;
    const timeout = window.setTimeout(() => {
      const animation = ambientAnimation(random());
      const loopDuration = resolveAnimationRow(animation, pet.frameMetadata)
        .durations.reduce((total, duration) => total + duration, 0);
      dispatchBehavior({
        type: 'AMBIENT_STARTED',
        animation,
        until: Date.now() + loopDuration,
      });
    }, ambientDelayMs(random()));
    return () => window.clearTimeout(timeout);
  }, [
    behavior.attention,
    behavior.mode,
    dispatchBehavior,
    due,
    motionAllowed,
    pet.frameMetadata,
    pet.id,
    random,
  ]);

  useEffect(() => {
    if (!motionAllowed) dispatchBehavior({ type: 'MOTION_DISABLED' });
  }, [dispatchBehavior, motionAllowed]);

  useEffect(() => () => {
    const session = pointerSessionRef.current;
    pointerSessionRef.current = undefined;
    if (session?.captured) {
      try {
        session.element.releasePointerCapture(session.pointerId);
      } catch {
        // Pointer capture may already be released during unmount.
      }
    }
  }, []);

  const releaseCapture = (session: PointerSession) => {
    if (!session.captured) return;
    try {
      session.element.releasePointerCapture(session.pointerId);
    } catch {
      // Browsers can release capture before the explicit pointer-up handler.
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0
      || pointerSessionRef.current !== undefined
      || behaviorRef.current.mode === 'failed') return;
    suppressClickRef.current = false;
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

  const activatePet = () => {
    dispatchBehavior({ type: 'PETTED', now: Date.now() });
    if (pet.spriteVersion === 2 && finePointer && motionAllowed) {
      dispatchBehavior({ type: 'ATTENTION_ARMED', now: Date.now() });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    if (behaviorRef.current.mode === 'failed') return;
    const dx = event.clientX - session.origin.x;
    const dy = event.clientY - session.origin.y;
    if (!session.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      session.dragging = true;
      dispatchBehavior({ type: 'DRAG_STARTED', facing: dx < 0 ? 'left' : 'right' });
      try {
        session.element.setPointerCapture(session.pointerId);
        session.captured = true;
      } catch {
        // Dragging remains available while the pointer stays over the button.
      }
    } else if (session.dragging && dx !== 0) {
      dispatchBehavior({ type: 'DRAG_STARTED', facing: dx < 0 ? 'left' : 'right' });
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

  const savePosition = () => {
    const viewport = viewportSize();
    const size = petSizeRef.current;
    const availableWidth = Math.max(0, viewport.width - size.width);
    const availableHeight = Math.max(0, viewport.height - size.height);
    const clamped = clampCatPosition(positionRef.current, viewport, size);
    void controller.savePetPosition({
      xRatio: availableWidth === 0 ? 0 : clamped.x / availableWidth,
      yRatio: availableHeight === 0 ? 0 : clamped.y / availableHeight,
    });
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    reason: 'up' | 'cancel' | 'lost' = 'up',
  ) => {
    const session = pointerSessionRef.current;
    if (session === undefined || session.pointerId !== event.pointerId) return;
    pointerSessionRef.current = undefined;
    if (session.dragging) {
      suppressClickRef.current = reason !== 'cancel';
      if (reason !== 'lost') releaseCapture(session);
      dispatchBehavior({ type: 'DRAG_ENDED' });
      savePosition();
      return;
    }
    if (reason !== 'up') {
      suppressClickRef.current = reason === 'lost';
      return;
    }
    suppressClickRef.current = true;
    if (behaviorRef.current.due) setBubbleOpen(true);
    else activatePet();
  };

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current && event.detail > 0) {
      suppressClickRef.current = false;
      return;
    }
    if (behaviorRef.current.due) setBubbleOpen(true);
    else activatePet();
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    window.petShell?.showContextMenu?.(event.screenX, event.screenY);
  };

  const anchor = useMemo(() => ({
    x: position.x,
    y: position.y,
    width: petSize.width,
    height: petSize.height,
  }), [petSize.height, petSize.width, position.x, position.y]);

  return (
    <>
      <button
        ref={petRef}
        type="button"
        className="interactive-cat-button codex-pet-button"
        data-testid="pet-stage"
        data-mode={behavior.mode}
        aria-label={due
          ? t('pet.openReminder', { name: pet.displayName })
          : t('pet.touch', { name: pet.displayName })}
        style={{
          position: 'fixed',
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          transition: 'none',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, 'cancel')}
        onLostPointerCapture={(event) => finishPointer(event, 'lost')}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {atlas?.blob === pet.spritesheet ? (
          <PetSprite
            atlasUrl={atlas.url}
            version={pet.spriteVersion}
            animation={behavior.animation}
            frameMetadata={pet.frameMetadata}
            lookDirection={pet.spriteVersion === 2
              && behavior.attention === 'tracking'
              && finePointer
              && motionAllowed
              ? lookDirection
              : null}
            animate={motionAllowed}
          />
        ) : <span className="cat-sprite-stack" aria-hidden="true" />}
      </button>
      <CatReminderBubble
        open={bubbleOpen}
        anchor={anchor}
        returnFocusRef={petRef}
        onRequestClose={() => {
          setBubbleOpen(false);
          dispatchBehavior({ type: 'BREAK_CANCELLED' });
        }}
        onActionStarted={() => dispatchBehavior({ type: 'BREAK_STARTED' })}
        onSnoozed={() => dispatchBehavior({ type: 'SNOOZED' })}
        onSkipped={() => dispatchBehavior({ type: 'SKIPPED' })}
      />
    </>
  );
}
