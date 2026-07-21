import { useEffect, useState } from 'react';
import { useAppSnapshot } from '../../../app/AppProvider';
import type { AppSnapshot } from '../../../app/model';
import type { Reminder, SchedulerState } from '../domain/types';
import { getReminderLabel } from '../domain/presentation';
import { useI18n } from '../../../i18n/I18nProvider';
import type { Translator } from '../../../i18n/messages';
import type { Locale } from '../../../i18n/types';

export function getReminderSummaries(reminders: Reminder[], now: number, locale: Locale = 'zh-CN') {
  return reminders
    .filter((item) => item.enabled)
    .map((item) => {
      const dueAt = item.snoozedUntil ?? item.nextDueAt;
      return {
        id: item.id,
        label: getReminderLabel(item, locale),
        dueAt,
        remainingSeconds: Math.max(0, Math.ceil((dueAt - now) / 1_000)),
      };
    })
    .sort((a, b) => a.dueAt - b.dueAt);
}

export interface GlobalReminderStatus {
  runtimeStatus: string;
  additionalSuppressionStatus?: string | undefined;
  dueStatus?: string | undefined;
  pauseRemainingSeconds?: number | undefined;
  notificationGuidance?: string | undefined;
}

export function getReminderDisplayNow(scheduler: SchedulerState, displayNow: number): number {
  const suppressionStarts = [
    scheduler.pausedAt,
    scheduler.quietStartedAt,
  ].filter((startedAt): startedAt is number => startedAt !== undefined);

  return suppressionStarts.length === 0
    ? displayNow
    : Math.min(displayNow, ...suppressionStarts);
}

export function getGlobalReminderStatus(
  snapshot: AppSnapshot,
  displayNow: number,
  t: Translator,
): GlobalReminderStatus {
  const enabled = snapshot.scheduler.reminders.some((reminder) => reminder.enabled);
  const dueCount = snapshot.scheduler.dueQueue.length;
  const paused = snapshot.scheduler.pausedAt !== undefined
    && snapshot.scheduler.pausedUntil !== undefined;
  const quiet = snapshot.scheduler.quietStartedAt !== undefined;
  let runtimeStatus: string;

  if (!enabled) runtimeStatus = t('dashboard.status.noneEnabled');
  else if (paused) runtimeStatus = t('dashboard.status.paused');
  else if (quiet) runtimeStatus = t('dashboard.status.quiet');
  else if (dueCount > 0) runtimeStatus = t('dashboard.status.due');
  else runtimeStatus = t('dashboard.status.onSchedule');

  const guidance = snapshot.notificationStatus === 'default'
    ? t('dashboard.notification.default')
    : snapshot.notificationStatus === 'denied'
      ? t('dashboard.notification.denied')
      : snapshot.notificationStatus === 'unavailable'
        ? t('dashboard.notification.unavailable')
        : undefined;
  return {
    runtimeStatus,
    additionalSuppressionStatus: paused && quiet ? t('dashboard.status.quiet') : undefined,
    dueStatus: dueCount > 0 ? t('dashboard.dueCount', { count: dueCount }) : undefined,
    pauseRemainingSeconds: paused
      ? Math.max(0, Math.ceil((snapshot.scheduler.pausedUntil! - displayNow) / 1_000))
      : undefined,
    notificationGuidance: guidance,
  };
}

function remainingLabel(seconds: number, t: Translator): string {
  if (seconds < 60) return t('dashboard.remaining.seconds', { seconds });
  if (seconds % 60 === 0) return t('dashboard.remaining.minutes', { minutes: seconds / 60 });
  return t('dashboard.remaining.minutesSeconds', {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

export function Dashboard() {
  const { locale, t } = useI18n();
  const snapshot = useAppSnapshot();
  const [displayNow, setDisplayNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setDisplayNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const reminderDisplayNow = getReminderDisplayNow(snapshot.scheduler, displayNow);
  const summaries = getReminderSummaries(snapshot.scheduler.reminders, reminderDisplayNow, locale);
  const next = summaries[0];
  const globalStatus = getGlobalReminderStatus(snapshot, displayNow, t);

  return (
    <section className="dashboard" aria-labelledby="companion-heading">
      <h1 id="companion-heading">{t('dashboard.heading', { name: snapshot.settings.cat.name })}</h1>
      <p className="reminder-global-status">{globalStatus.runtimeStatus}</p>
      {globalStatus.additionalSuppressionStatus !== undefined && (
        <p className="reminder-suppression-status">{globalStatus.additionalSuppressionStatus}</p>
      )}
      {globalStatus.pauseRemainingSeconds !== undefined && (
        <p className="reminder-pause-remaining" data-testid="pause-remaining">
          {t('dashboard.pauseRemaining', { time: remainingLabel(globalStatus.pauseRemainingSeconds, t) })}
        </p>
      )}
      {globalStatus.dueStatus !== undefined && (
        <p className="reminder-due-status">{globalStatus.dueStatus}</p>
      )}
      {globalStatus.notificationGuidance !== undefined && (
        <p className="reminder-notification-guidance" data-testid="notification-guidance">
          {globalStatus.notificationGuidance}
        </p>
      )}
      {next === undefined ? (
        null
      ) : (
        <>
          <article className="next-reminder" data-testid="next-reminder">
            <p>{t('dashboard.next')}</p>
            <h2>{next.label}</h2>
            <p>{remainingLabel(next.remainingSeconds, t)}</p>
          </article>
          {summaries.length > 1 && (
            <ul className="later-reminders" aria-label={t('dashboard.later')}>
              {summaries.slice(1).map((item) => (
                <li key={item.id} data-testid="later-reminder">
                  <span>{item.label}</span>
                  <span>{remainingLabel(item.remainingSeconds, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
