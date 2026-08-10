import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '../../app/model';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import { getAffinityLevel, type AffinityLevel } from '../../features/cat/domain/affinity';
import {
  localMidnight,
  nextLocalMidnight,
  summarizeToday,
} from '../../features/insights/InsightsPanel';
import { BUILTIN_PET_ID } from '../../features/pets/domain/types';
import {
  getReminderDisplayNow,
  getReminderSummaries,
} from '../../features/reminders/components/Dashboard';
import { useI18n } from '../../i18n/I18nProvider';
import type { Translator } from '../../i18n/messages';

const systemNow = (): number => Date.now();

const affinityKeys: Record<AffinityLevel,
  'insights.affinity.new' | 'insights.affinity.familiar' | 'insights.affinity.close' | 'insights.affinity.best-friend'> = {
  new: 'insights.affinity.new',
  familiar: 'insights.affinity.familiar',
  close: 'insights.affinity.close',
  'best-friend': 'insights.affinity.best-friend',
};

type AndroidStatusKey =
  | 'android.companion.status.noneEnabled'
  | 'android.companion.status.paused'
  | 'android.companion.status.quiet'
  | 'android.companion.status.due'
  | 'android.companion.status.onSchedule';

function statusKey(snapshot: AppSnapshot): AndroidStatusKey {
  if (!snapshot.scheduler.reminders.some((reminder) => reminder.enabled)) {
    return 'android.companion.status.noneEnabled';
  }
  if (snapshot.scheduler.pausedAt !== undefined && snapshot.scheduler.pausedUntil !== undefined) {
    return 'android.companion.status.paused';
  }
  if (snapshot.scheduler.quietStartedAt !== undefined) return 'android.companion.status.quiet';
  if (snapshot.scheduler.dueQueue.length > 0) return 'android.companion.status.due';
  return 'android.companion.status.onSchedule';
}

function remainingLabel(seconds: number, t: Translator): string {
  if (seconds < 60) return t('dashboard.remaining.seconds', { seconds });
  if (seconds % 60 === 0) return t('dashboard.remaining.minutes', { minutes: seconds / 60 });
  return t('dashboard.remaining.minutesSeconds', {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

export function AndroidCompanionView({ now = systemNow }: { now?: () => number }) {
  const { locale, t } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const [displayNow, setDisplayNow] = useState(now);
  const [todayCount, setTodayCount] = useState(0);
  const historyRequest = useRef(0);

  const loadToday = useCallback(() => {
    const request = ++historyRequest.current;
    const requestedAt = now();
    void controller.listHistorySince(localMidnight(new Date(requestedAt))).then((events) => {
      if (historyRequest.current === request) {
        setTodayCount(summarizeToday(events, new Date(requestedAt)).length);
      }
    }).catch(() => {
      // Preserve the last valid total when the lightweight history read fails.
    });
  }, [controller, now]);

  useEffect(() => {
    loadToday();
    return () => { historyRequest.current += 1; };
  }, [loadToday, snapshot.historyRevision]);

  useEffect(() => {
    let midnightTimer: number | undefined;
    const stop = (): void => {
      if (midnightTimer === undefined) return;
      window.clearTimeout(midnightTimer);
      midnightTimer = undefined;
    };
    const schedule = (): void => {
      stop();
      if (document.visibilityState === 'hidden') return;
      const current = new Date(now());
      midnightTimer = window.setTimeout(() => {
        loadToday();
        schedule();
      }, Math.max(0, nextLocalMidnight(current) - current.getTime()));
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') stop();
      else {
        loadToday();
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [loadToday, now]);

  useEffect(() => {
    let timer: number | undefined;
    const stop = (): void => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const start = (): void => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => setDisplayNow(now()), 1_000);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      setDisplayNow(now());
      start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [now]);

  const reminderNow = getReminderDisplayNow(snapshot.scheduler, displayNow);
  const reminders = getReminderSummaries(snapshot.scheduler.reminders, reminderNow, locale);
  const next = reminders[0];
  const later = reminders[1];
  const affinity = snapshot.settings.affinity;
  const affinityLevel = t(affinityKeys[getAffinityLevel(affinity)]);
  const activePet = snapshot.settings.activePetId === BUILTIN_PET_ID
    ? snapshot.settings.cat.name
    : snapshot.pets.find(({ id }) => id === snapshot.settings.activePetId)?.displayName
      ?? snapshot.settings.activePetId;

  return (
    <section
      className="android-companion"
      data-testid="android-companion"
      aria-label={t('nav.companion')}
    >
      <header className="android-companion-header">
        <div>
          <p className="android-companion-kicker">{t('nav.companion')}</p>
          <p className="android-companion-label">{t('android.companion.currentPet')}</p>
          <h1>{activePet}</h1>
        </div>
        <div className="android-companion-status">
          <span>{t(statusKey(snapshot))}</span>
          <span>{t('android.companion.affinity', { value: affinity })}</span>
        </div>
      </header>

      {next === undefined ? (
        <p className="android-companion-empty">{t('android.companion.empty')}</p>
      ) : (
        <article className="android-next-reminder" data-testid="android-next-reminder">
          <p>{t('android.companion.next')}</p>
          <h2>{next.label}</h2>
          <p className="android-next-countdown" data-testid="android-next-countdown">
            {remainingLabel(next.remainingSeconds, t)}
          </p>
        </article>
      )}

      <div className="android-companion-summaries">
        <article data-testid="android-today-summary">
          <p>{t('android.companion.today')}</p>
          <strong>{t('android.companion.todayTotal', { count: todayCount })}</strong>
        </article>
        <article data-testid="android-relationship-summary">
          <p>{t('android.companion.relationship')}</p>
          <strong>{t('android.companion.relationshipValue', { level: affinityLevel, value: affinity })}</strong>
        </article>
      </div>

      {later !== undefined && (
        <article className="android-later-reminder" data-testid="android-later-reminder">
          <p>{t('android.companion.later')}</p>
          <strong>{later.label}</strong>
          <span>{remainingLabel(later.remainingSeconds, t)}</span>
        </article>
      )}
    </section>
  );
}
