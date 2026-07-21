import { useEffect, useRef, useState } from 'react';
import { useAppController } from '../../../app/AppProvider';
import type { Reminder } from '../domain/types';
import { getReminderActionCopy, getReminderLabel } from '../domain/presentation';
import { useI18n } from '../../../i18n/I18nProvider';

interface ActionCardProps {
  reminder: Reminder;
  countdownEndsAt?: number | undefined;
  onCountdownStarted?: ((endsAt: number) => void) | undefined;
  completionAction?: {
    label: string;
    onActivate: () => void;
  };
}

export function ActionCard({
  reminder,
  countdownEndsAt,
  onCountdownStarted,
  completionAction,
}: ActionCardProps) {
  const { locale, t } = useI18n();
  const controller = useAppController();
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => (
    countdownEndsAt === undefined
      ? null
      : Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1_000))
  ));
  const [completed, setCompleted] = useState(false);
  const [completionPending, setCompletionPending] = useState(false);
  const completionPendingRef = useRef(false);
  const countdownStartRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const duration = reminder.kind === 'preset' ? reminder.optionalActionDurationSeconds : undefined;
  const supportsCountdown = reminder.kind === 'preset' && duration !== undefined
    && (reminder.type === 'lookAway' || reminder.type === 'takeBreak');

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setRemainingSeconds((seconds) => seconds === null ? null : Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [remainingSeconds]);

  useEffect(() => {
    if (completed) confirmationRef.current?.focus();
  }, [completed]);

  useEffect(() => {
    (countdownStartRef.current ?? completeRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (remainingSeconds !== null && !completed) completeRef.current?.focus();
  }, [remainingSeconds === null, completed]);

  const complete = async () => {
    if (completionPendingRef.current) return;
    completionPendingRef.current = true;
    setCompletionPending(true);
    try {
      await controller.complete(reminder.id);
      setCompleted(true);
    } catch {
      // Keep the action available when its controller command does not complete.
    } finally {
      completionPendingRef.current = false;
      setCompletionPending(false);
    }
  };

  return (
    <article className="action-card">
      <p>{getReminderActionCopy(reminder, locale)}</p>
      {!completed && supportsCountdown && remainingSeconds === null && (
        <button
          ref={countdownStartRef}
          type="button"
          onClick={() => {
            setRemainingSeconds(duration);
            onCountdownStarted?.(Date.now() + duration * 1_000);
          }}
        >
          {t('action.startTimer', { seconds: duration })}
        </button>
      )}
      {!completed && supportsCountdown && remainingSeconds !== null && (
        <p aria-live="polite">
          {remainingSeconds > 0
            ? t('action.remainingSeconds', { seconds: remainingSeconds })
            : t('action.timerFinished')}
        </p>
      )}
      {!completed && (
        <button
          ref={completeRef}
          type="button"
          disabled={completionPending}
          onClick={() => void complete()}
        >
          {t('action.complete')}
        </button>
      )}
      {completed && (
        <>
          <p ref={confirmationRef} role="status" aria-live="polite" tabIndex={-1}>
            {t('action.completed', { label: getReminderLabel(reminder, locale) })}
          </p>
          {completionAction !== undefined && (
            <button type="button" onClick={completionAction.onActivate}>
              {completionAction.label}
            </button>
          )}
        </>
      )}
    </article>
  );
}
