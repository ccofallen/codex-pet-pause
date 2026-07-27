import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAppController, useAppSnapshot } from '../../../app/AppProvider';
import { ActionCard } from '../../reminders/components/ActionCard';
import { getCatReminderCopy, getReminderLabel } from '../../reminders/domain/presentation';
import { placeBubble, type BubblePlacement } from '../stage/viewport';
import { useI18n } from '../../../i18n/I18nProvider';

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface CatAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CatReminderBubbleProps {
  open: boolean;
  anchor: CatAnchor;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onRequestClose(): void;
  onActionStarted?(): void;
  onSnoozed?(): void;
  onSkipped?(): void;
}

export function CatReminderBubble({
  open,
  anchor,
  returnFocusRef,
  onRequestClose,
  onActionStarted,
  onSnoozed,
  onSkipped,
}: CatReminderBubbleProps) {
  const snapshot = useAppSnapshot();
  const controller = useAppController();
  const { locale, t } = useI18n();
  const current = snapshot.scheduler.dueQueue[0];
  const reminder = current === undefined
    ? undefined
    : snapshot.scheduler.reminders.find((item) => item.id === current.reminderId);
  const currentOccurrenceKey = current === undefined
    ? undefined
    : `${current.reminderId}:${current.dueAt}`;
  const queueLength = snapshot.scheduler.dueQueue.length;
  const [actionOpen, setActionOpen] = useState(false);
  const [actionReminder, setActionReminder] = useState<typeof reminder>();
  const [actionOccurrenceKey, setActionOccurrenceKey] = useState<string>();
  const [countdown, setCountdown] = useState<{ occurrenceKey: string; endsAt: number }>();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [queueProgress, setQueueProgress] = useState({
    current: 1,
    total: Math.max(1, queueLength),
  });
  const [placement, setPlacement] = useState<BubblePlacement>({
    side: 'top',
    left: anchor.x,
    top: anchor.y,
  });
  const bubbleRef = useRef<HTMLElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const tenMinuteRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  const progressOccurrenceRef = useRef<string | undefined>(undefined);
  const titleId = useId();
  const actionVisible = actionOpen && actionReminder !== undefined;
  const displayedReminder = actionVisible ? actionReminder : reminder;
  const countdownEndsAt = countdown !== undefined && countdown.occurrenceKey === actionOccurrenceKey
    ? countdown.endsAt
    : undefined;
  const visible = open && displayedReminder !== undefined;
  const wasVisibleRef = useRef(visible);
  const renderedQueueProgress = progressOccurrenceRef.current === undefined
    ? { current: 1, total: Math.max(1, queueLength) }
    : queueProgress;

  useEffect(() => {
    if (open) return;
    const runningCountdown = countdown !== undefined
      && countdown.occurrenceKey === actionOccurrenceKey
      && countdown.endsAt > Date.now();
    if (!runningCountdown) {
      setActionOpen(false);
      setActionReminder(undefined);
    }
    setSnoozeOpen(false);
  }, [open, countdown, actionOccurrenceKey]);

  useEffect(() => {
    if (!actionOpen) setSnoozeOpen(false);
  }, [currentOccurrenceKey, actionOpen]);

  useEffect(() => {
    if (!open) {
      progressOccurrenceRef.current = undefined;
      return;
    }
    if (actionVisible) return;
    if (currentOccurrenceKey === undefined) {
      progressOccurrenceRef.current = undefined;
      return;
    }
    const previousOccurrenceKey = progressOccurrenceRef.current;
    progressOccurrenceRef.current = currentOccurrenceKey;
    if (previousOccurrenceKey === undefined) {
      setQueueProgress((progress) => (
        progress.current === 1 && progress.total === Math.max(1, queueLength)
          ? progress
          : { current: 1, total: Math.max(1, queueLength) }
      ));
      return;
    }
    if (previousOccurrenceKey !== currentOccurrenceKey) {
      setQueueProgress((progress) => {
        const nextCurrent = progress.current + 1;
        return {
          current: nextCurrent,
          total: Math.max(progress.total, nextCurrent + queueLength - 1),
        };
      });
      return;
    }
    setQueueProgress((progress) => {
      const nextTotal = Math.max(progress.total, progress.current + queueLength - 1);
      return nextTotal === progress.total ? progress : { ...progress, total: nextTotal };
    });
  }, [open, actionVisible, currentOccurrenceKey, queueLength]);

  useEffect(() => {
    if (open && displayedReminder !== undefined && !actionVisible && !snoozeOpen) {
      firstActionRef.current?.focus();
    }
  }, [open, currentOccurrenceKey, actionVisible, snoozeOpen]);

  useEffect(() => {
    if (open && displayedReminder !== undefined && !actionVisible && snoozeOpen) {
      tenMinuteRef.current?.focus();
    }
  }, [open, currentOccurrenceKey, actionVisible, snoozeOpen]);

  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    const wasVisible = wasVisibleRef.current;
    if (wasOpen && !open || open && wasVisible && !visible) {
      returnFocusRef.current?.focus();
    }
    wasOpenRef.current = open;
    wasVisibleRef.current = visible;
  }, [open, visible, returnFocusRef]);

  const updatePlacement = useCallback(() => {
    const bubble = bubbleRef.current;
    if (bubble === null) return;
    const bounds = bubble.getBoundingClientRect();
    const nextPlacement = placeBubble(
      anchor,
      { width: window.innerWidth, height: window.innerHeight },
      { width: bounds.width, height: bounds.height },
    );
    setPlacement((currentPlacement) => (
      currentPlacement.side === nextPlacement.side
      && currentPlacement.left === nextPlacement.left
      && currentPlacement.top === nextPlacement.top
        ? currentPlacement
        : nextPlacement
    ));
  }, [
    anchor.x,
    anchor.y,
    anchor.width,
    anchor.height,
  ]);

  useLayoutEffect(() => {
    if (!visible) return;
    updatePlacement();
  }, [
    visible,
    currentOccurrenceKey,
    displayedReminder,
    actionVisible,
    snoozeOpen,
    updatePlacement,
  ]);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const bubble = bubbleRef.current;
    const cat = returnFocusRef.current;
    const shell = bubble?.parentElement;
    if (bubble === null || cat === null || !shell?.classList.contains('app-shell')) return undefined;

    const priorInert = new Map<HTMLElement, boolean>();
    const isolateDirectSurfaces = () => {
      for (const child of shell.children) {
        if (!(child instanceof HTMLElement) || child === cat || child === bubble) continue;
        if (!priorInert.has(child)) priorInert.set(child, child.hasAttribute('inert'));
        child.setAttribute('inert', '');
      }
    };
    isolateDirectSurfaces();
    const observer = new MutationObserver(isolateDirectSurfaces);
    observer.observe(shell, { childList: true });

    return () => {
      observer.disconnect();
      for (const [surface, wasInert] of priorInert) {
        if (wasInert) surface.setAttribute('inert', '');
        else surface.removeAttribute('inert');
      }
    };
  }, [visible, returnFocusRef]);

  useEffect(() => {
    if (!visible) return undefined;
    const bubble = bubbleRef.current;
    window.addEventListener('resize', updatePlacement);
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => updatePlacement());
    if (bubble !== null) observer?.observe(bubble);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      observer?.disconnect();
    };
  }, [visible, updatePlacement]);

  if (!open || displayedReminder === undefined) return null;

  const keepFocusInside = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onRequestClose();
      returnFocusRef.current?.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (!focusable.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const snooze = (minutes: 5 | 10 | 15) => {
    if (current === undefined) return;
    setSnoozeOpen(false);
    onSnoozed?.();
    void controller.snooze(current.reminderId, minutes);
  };

  return (
    <section
      ref={bubbleRef}
      className="cat-reminder-bubble"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-side={placement.side}
      style={{ position: 'fixed', left: placement.left, top: placement.top }}
      onKeyDown={keepFocusInside}
    >
      <div className="cat-reminder-bubble-content">
        <h2 id={titleId}>{t('pet.reminder.title', { label: getReminderLabel(displayedReminder, locale) })}</h2>
        {renderedQueueProgress.total > 1 && (
          <p className="reminder-queue-progress" aria-live="polite">
            {t('pet.reminder.queueProgress', renderedQueueProgress)}
          </p>
        )}
        {actionVisible ? (
          <ActionCard
            reminder={displayedReminder}
            countdownEndsAt={countdownEndsAt}
            onCountdownStarted={(endsAt) => {
              if (actionOccurrenceKey !== undefined) {
                setCountdown({ occurrenceKey: actionOccurrenceKey, endsAt });
              }
            }}
            onCompleted={() => {
              setActionOpen(false);
              setActionReminder(undefined);
              setActionOccurrenceKey(undefined);
              setCountdown(undefined);
              setSnoozeOpen(false);
              if (controller.getSnapshot().scheduler.dueQueue.length === 0) {
                onRequestClose();
                returnFocusRef.current?.focus();
              }
            }}
          />
        ) : (
          <>
            <p>{getCatReminderCopy(displayedReminder, locale)}</p>
            <div className="due-actions">
              <button
                ref={firstActionRef}
                type="button"
                onClick={() => {
                  onActionStarted?.();
                  setActionOccurrenceKey(currentOccurrenceKey);
                  setActionReminder(reminder);
                  setActionOpen(true);
                }}
              >
                {t('pet.reminder.doNow')}
              </button>
              <button type="button" onClick={() => setSnoozeOpen(true)}>{t('pet.reminder.later')}</button>
              <button
                type="button"
                onClick={() => {
                  if (current !== undefined) {
                    onSkipped?.();
                    void controller.skip(current.reminderId);
                  }
                }}
              >
                {t('pet.reminder.skip')}
              </button>
            </div>
            {snoozeOpen && (
              <div className="snooze-options" role="group" aria-label={t('pet.reminder.laterOptions')}>
                <button type="button" onClick={() => snooze(5)}>{t('pet.reminder.minutes', { minutes: 5 })}</button>
                <button ref={tenMinuteRef} type="button" onClick={() => snooze(10)}>{t('pet.reminder.minutes', { minutes: 10 })}</button>
                <button type="button" onClick={() => snooze(15)}>{t('pet.reminder.minutes', { minutes: 15 })}</button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
