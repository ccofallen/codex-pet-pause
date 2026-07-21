import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import type { ActivityEvent } from '../../app/model';
import { getAffinityLevel } from '../cat/domain/affinity';
import type { AffinityLevel } from '../cat/domain/affinity';
import type { PresetReminderType } from '../reminders/domain/types';
import { getReminderLabel } from '../reminders/domain/presentation';
import { useI18n } from '../../i18n/I18nProvider';

export const localMidnight = (now: Date): number => (
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
);

export const nextLocalMidnight = (now: Date): number => (
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
);

const reminderTypes: PresetReminderType[] = ['lookAway', 'drinkWater', 'standUp', 'takeBreak'];
const affinityMessageKeys: Record<AffinityLevel,
  'insights.affinity.new' | 'insights.affinity.familiar' | 'insights.affinity.close' | 'insights.affinity.best-friend'> = {
  new: 'insights.affinity.new',
  familiar: 'insights.affinity.familiar',
  close: 'insights.affinity.close',
  'best-friend': 'insights.affinity.best-friend',
};

export const summarizeToday = (events: ActivityEvent[], now: Date): ActivityEvent[] => {
  const midnight = localMidnight(now);
  const currentTime = now.getTime();
  return events.filter((event) => event.action === 'completed'
    && Number.isFinite(event.occurredAt)
    && event.occurredAt >= midnight
    && event.occurredAt <= currentTime);
};

interface InsightsPanelProps {
  now?: () => Date;
}

const systemNow = (): Date => new Date();

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; events: ActivityEvent[] }
  | { status: 'error' };

export function InsightsPanel({ now = systemNow }: InsightsPanelProps) {
  const { locale, t } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const affinity = snapshot.settings.affinity;
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const requestId = useRef(0);

  const load = useCallback(() => {
    const currentRequest = ++requestId.current;
    const currentNow = now();
    setLoadState({ status: 'loading' });
    void controller.listHistorySince(localMidnight(currentNow)).then((events) => {
      if (requestId.current === currentRequest) {
        setLoadState({ status: 'ready', events: summarizeToday(events, currentNow) });
      }
    }).catch(() => {
      if (requestId.current === currentRequest) setLoadState({ status: 'error' });
    });
  }, [controller, now]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load, snapshot.historyRevision]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const schedule = (): void => {
      const current = now();
      timer = setTimeout(() => {
        if (cancelled) return;
        load();
        schedule();
      }, Math.max(0, nextLocalMidnight(current) - current.getTime()));
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load, now]);

  const events = loadState.status === 'ready' ? loadState.events : [];
  const affinityLevel = getAffinityLevel(affinity);

  return (
    <section className="insights-panel" aria-labelledby="insights-heading">
      <h2 id="insights-heading">{t('insights.heading')}</h2>
      {loadState.status === 'loading' && <p aria-live="polite">{t('insights.loading')}</p>}
      {loadState.status === 'error' && (
        <div role="status">
          <p>{t('insights.unavailable')}</p>
          <button type="button" onClick={load}>{t('insights.retry')}</button>
        </div>
      )}
      {loadState.status === 'ready' && (
        <>
          <p className="insights-total">{t('insights.total', { count: events.length })}</p>
          <ul className="insights-counts" aria-label={t('insights.categories')}>
            {reminderTypes.map((type) => {
              const count = events.filter((event) => event.reminderType === type).length;
              const label = getReminderLabel({
                id: type,
                kind: 'preset',
                type,
                enabled: false,
                intervalMinutes: 1,
                nextDueAt: 0,
                status: 'disabled',
              }, locale);
              return <li key={type}>{t('insights.categoryCount', { label, count })}</li>;
            })}
          </ul>
        </>
      )}
      <p className="affinity-status">
        {t('insights.affinity', { value: affinity, level: t(affinityMessageKeys[affinityLevel]) })}
      </p>
    </section>
  );
}
