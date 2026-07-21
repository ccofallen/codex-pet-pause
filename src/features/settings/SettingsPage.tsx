import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppController, useAppSnapshot } from '../../app/AppProvider';
import { isCurrentQuietRuntime } from '../../app/appController';
import type {
  AppSettings, AppSnapshot, NotificationStatus, QuietHours, ThemeMode,
} from '../../app/model';
import { isPresetReminder } from '../reminders/domain/types';
import type {
  PresetReminderType, Reminder, SchedulerState,
} from '../reminders/domain/types';
import { getReminderLabel } from '../reminders/domain/presentation';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/types';
import { CustomReminderSettings } from './CustomReminderSettings';

export interface SettingsPageProps {
  section?: 'reminders' | 'general';
  now?: () => number;
}

const systemTimestamp = (): number => Date.now();

const reminderTypes: PresetReminderType[] = ['lookAway', 'drinkWater', 'standUp', 'takeBreak'];
const actionDurationTypes = new Set<PresetReminderType>(['lookAway', 'takeBreak']);

const parseDecimalInteger = (value: string): number | undefined => (
  /^\d+$/.test(value) ? Number(value) : undefined
);

function quietHoursEqual(left: QuietHours, right: QuietHours): boolean {
  return left.enabled === right.enabled
    && left.startMinutes === right.startMinutes
    && left.endMinutes === right.endMinutes;
}

export function isActivePauseRuntime(scheduler: SchedulerState, now: number): boolean {
  return scheduler.pausedUntil !== undefined
    && Number.isFinite(scheduler.pausedUntil)
    && scheduler.pausedUntil > now;
}

export function effectiveReminderRestartAt(
  snapshot: AppSnapshot,
  now: number,
  nextQuietHours: QuietHours = snapshot.settings.quietHours,
): number {
  const starts = [
    isActivePauseRuntime(snapshot.scheduler, now)
      ? snapshot.scheduler.pausedAt
      : undefined,
    quietHoursEqual(snapshot.settings.quietHours, nextQuietHours)
      && snapshot.scheduler.quietStartedAt !== undefined
      && isCurrentQuietRuntime(snapshot.scheduler.quietStartedAt, now, nextQuietHours)
      ? snapshot.scheduler.quietStartedAt
      : undefined,
  ]
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return starts.length === 0 ? now : Math.min(...starts);
}

export function applyReminderEdits(current: Reminder[], draft: Reminder[], now: number): Reminder[] {
  return draft.map((next) => {
    const previous = current.find((item) => item.id === next.id);
    if (!next.enabled) {
      return { ...next, status: 'disabled', snoozedUntil: undefined };
    }
    const restarted = previous !== undefined && (
      (!previous.enabled && next.enabled)
      || (previous.enabled && previous.intervalMinutes !== next.intervalMinutes)
    );
    return restarted
      ? {
        ...next,
        status: 'scheduled',
        snoozedUntil: undefined,
        nextDueAt: now + next.intervalMinutes * 60_000,
      }
      : next;
  });
}

const minutesToTime = (minutes: number): string => (
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
);

function timeToMinutes(value: string): number | undefined {
  if (!/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  return hours !== undefined && minutes !== undefined && hours <= 23 && minutes <= 59
    ? hours * 60 + minutes
    : undefined;
}

interface ReminderDraft {
  enabled: boolean;
  interval: string;
  actionDuration: string;
}

type ReminderValidationIssue =
  | { code: 'interval'; type: PresetReminderType }
  | { code: 'action-duration'; type: PresetReminderType }
  | { code: 'quiet-format' }
  | { code: 'quiet-equal' };

type SettingsError =
  | { code: 'session-only' }
  | { code: 'language-save-failed' }
  | { code: 'reminders-save-failed' }
  | { code: 'general-save-failed' }
  | { code: 'pause-failed' }
  | { code: 'resume-failed' }
  | { code: 'notification-request-failed' }
  | { code: 'reminder-validation'; issues: ReminderValidationIssue[] };

type SettingsMessageCode = 'language-saved' | 'reminders-saved' | 'general-saved';
type ResetErrorCode = 'acknowledge-required' | 'reset-failed';

function reminderDrafts(settings: AppSettings): Record<PresetReminderType, ReminderDraft> {
  return Object.fromEntries(settings.reminders.filter(isPresetReminder).map((reminder) => [reminder.type, {
    enabled: reminder.enabled,
    interval: String(reminder.intervalMinutes),
    actionDuration: reminder.optionalActionDurationSeconds === undefined
      ? ''
      : String(reminder.optionalActionDurationSeconds),
  }])) as Record<PresetReminderType, ReminderDraft>;
}

const notificationCopy: Record<NotificationStatus,
  | 'settings.notifications.default'
  | 'settings.notifications.granted'
  | 'settings.notifications.denied'
  | 'settings.notifications.unavailable'> = {
  default: 'settings.notifications.default',
  granted: 'settings.notifications.granted',
  denied: 'settings.notifications.denied',
  unavailable: 'settings.notifications.unavailable',
};

export function SettingsPage({ section = 'general', now = systemTimestamp }: SettingsPageProps) {
  const { locale, t, formatTime } = useI18n();
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  const [reminders, setReminders] = useState(() => reminderDrafts(snapshot.settings));
  const [quietEnabled, setQuietEnabled] = useState(snapshot.settings.quietHours.enabled);
  const [quietStart, setQuietStart] = useState(() => minutesToTime(snapshot.settings.quietHours.startMinutes));
  const [quietEnd, setQuietEnd] = useState(() => minutesToTime(snapshot.settings.quietHours.endMinutes));
  const [theme, setTheme] = useState<ThemeMode>(snapshot.settings.theme);
  const [soundEnabled, setSoundEnabled] = useState(snapshot.settings.soundEnabled);
  const [animationsEnabled, setAnimationsEnabled] = useState(snapshot.settings.animationsEnabled);
  const [error, setError] = useState<SettingsError>();
  const [message, setMessage] = useState<SettingsMessageCode>();
  const [pending, setPending] = useState(false);
  const [localePending, setLocalePending] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [resetError, setResetError] = useState<ResetErrorCode>();
  const inFlightRef = useRef(false);
  const localeFlightRef = useRef(false);
  const localeRadiosRef = useRef(new Map<Locale, HTMLInputElement>());
  const localeFocusTargetRef = useRef<Locale | undefined>(undefined);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const activePause = isActivePauseRuntime(snapshot.scheduler, now());
  const presetReminders = snapshot.settings.reminders.filter(isPresetReminder);
  const reminderLabel = (type: PresetReminderType): string => (
    getReminderLabel(presetReminders.find((reminder) => reminder.type === type)!, locale)
  );

  const errorText = (value: SettingsError): string => {
    switch (value.code) {
      case 'session-only': return t('settings.sessionOnly');
      case 'language-save-failed': return t('settings.language.saveFailed');
      case 'reminders-save-failed': return t('settings.reminders.saveFailed');
      case 'general-save-failed': return t('settings.general.saveFailed');
      case 'pause-failed': return t('settings.pause.pauseFailed');
      case 'resume-failed': return t('settings.pause.resumeFailed');
      case 'notification-request-failed': return t('settings.notifications.requestFailed');
      case 'reminder-validation': {
        const messages = value.issues.map((issue) => {
          if (issue.code === 'quiet-format') return t('settings.error.quietFormat');
          if (issue.code === 'quiet-equal') return t('settings.error.quietEqual');
          const label = reminderLabel(issue.type);
          return issue.code === 'interval'
            ? t('settings.error.reminderInterval', { label, minimum: 1, maximum: 720 })
            : t('settings.error.actionDuration', { label, minimum: 10, maximum: 7200 });
        });
        return t('settings.error.list', { messages });
      }
    }
  };

  const messageText = (value: SettingsMessageCode): string => {
    switch (value) {
      case 'language-saved': return t('settings.language.saved');
      case 'reminders-saved': return t('settings.reminders.saved');
      case 'general-saved': return t('settings.general.saved');
    }
  };

  const resetErrorText = (value: ResetErrorCode): string => (
    value === 'acknowledge-required'
      ? t('settings.reset.acknowledgeRequired')
      : t('settings.reset.failed')
  );

  useLayoutEffect(() => {
    if (localePending || localeFocusTargetRef.current === undefined) return;
    const target = localeFocusTargetRef.current;
    localeFocusTargetRef.current = undefined;
    localeRadiosRef.current.get(target)?.focus();
  }, [locale, localePending]);

  const beginAction = (): boolean => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    return true;
  };

  const finishAction = (): void => {
    inFlightRef.current = false;
    setPending(false);
  };

  const syncDraft = (settings: AppSettings): void => {
    setReminders(reminderDrafts(settings));
    setQuietEnabled(settings.quietHours.enabled);
    setQuietStart(minutesToTime(settings.quietHours.startMinutes));
    setQuietEnd(minutesToTime(settings.quietHours.endMinutes));
    setTheme(settings.theme);
    setSoundEnabled(settings.soundEnabled);
    setAnimationsEnabled(settings.animationsEnabled);
  };

  const updateReminder = (type: PresetReminderType, patch: Partial<ReminderDraft>): void => {
    setReminders((current) => ({ ...current, [type]: { ...current[type], ...patch } }));
  };

  const changeLocale = async (nextLocale: Locale): Promise<void> => {
    if (localeFlightRef.current
      || nextLocale === controller.getSnapshot().settings.locale) return;
    localeFlightRef.current = true;
    setLocalePending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await controller.setLocale(nextLocale);
      const result = controller.getSnapshot();
      if (result.storageMode === 'temporary' || result.nonBlockingError === 'settings-write-failed') {
        setError({ code: 'session-only' });
      } else {
        setMessage('language-saved');
      }
    } catch {
      setError({ code: 'language-save-failed' });
    } finally {
      localeFlightRef.current = false;
      localeFocusTargetRef.current = controller.getSnapshot().settings.locale;
      setLocalePending(false);
    }
  };

  const saveReminderSettings = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (inFlightRef.current) return;
    setError(undefined);
    setMessage(undefined);
    const errors: ReminderValidationIssue[] = [];
    const parsed = new Map<PresetReminderType, { interval: number; actionDuration?: number }>();
    reminderTypes.forEach((type) => {
      const interval = parseDecimalInteger(reminders[type].interval);
      if (interval === undefined || interval < 1 || interval > 720) {
        errors.push({ code: 'interval', type });
      }
      const actionText = reminders[type].actionDuration;
      let actionDuration: number | undefined;
      if (actionDurationTypes.has(type) && actionText !== '') {
        actionDuration = parseDecimalInteger(actionText);
        if (actionDuration === undefined || actionDuration < 10 || actionDuration > 7200) {
          errors.push({ code: 'action-duration', type });
        }
      }
      parsed.set(type, { interval: interval ?? Number.NaN, ...(actionDuration === undefined ? {} : { actionDuration }) });
    });
    const startMinutes = timeToMinutes(quietStart);
    const endMinutes = timeToMinutes(quietEnd);
    if (startMinutes === undefined || endMinutes === undefined) errors.push({ code: 'quiet-format' });
    else if (quietEnabled && startMinutes === endMinutes) errors.push({ code: 'quiet-equal' });
    if (errors.length > 0 || startMinutes === undefined || endMinutes === undefined) {
      setError({ code: 'reminder-validation', issues: errors });
      return;
    }
    if (!beginAction()) return;
    const currentSnapshot = controller.getSnapshot();
    const savedAt = now();
    const currentSettings = currentSnapshot.settings;
    const nextQuietHours = { enabled: quietEnabled, startMinutes, endMinutes };
    const reminderRestartAt = effectiveReminderRestartAt(currentSnapshot, savedAt, nextQuietHours);
    const nextReminders = currentSettings.reminders.map((reminder) => {
      if (!isPresetReminder(reminder)) return reminder;
      const values = parsed.get(reminder.type)!;
      const actionDuration = actionDurationTypes.has(reminder.type) ? values.actionDuration : undefined;
      const { optionalActionDurationSeconds: _previousActionDuration, ...withoutActionDuration } = reminder;
      return {
        ...withoutActionDuration,
        enabled: reminders[reminder.type].enabled,
        intervalMinutes: values.interval,
        ...(actionDuration === undefined ? {} : { optionalActionDurationSeconds: actionDuration }),
      };
    });
    const next: AppSettings = {
      ...currentSettings,
      reminders: applyReminderEdits(currentSettings.reminders, nextReminders, reminderRestartAt),
      quietHours: nextQuietHours,
    };
    try {
      await controller.saveSettings(next);
      syncDraft(controller.getSnapshot().settings);
      const result = controller.getSnapshot();
      if (result.storageMode === 'temporary' || result.nonBlockingError === 'settings-write-failed') {
        setError({ code: 'session-only' });
      } else setMessage('reminders-saved');
    } catch {
      setError({ code: 'reminders-save-failed' });
    } finally {
      finishAction();
    }
  };

  const saveGeneralSettings = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!beginAction()) return;
    try {
      await controller.saveSettings({ ...controller.getSnapshot().settings, theme, soundEnabled, animationsEnabled });
      syncDraft(controller.getSnapshot().settings);
      const result = controller.getSnapshot();
      if (result.storageMode === 'temporary' || result.nonBlockingError === 'settings-write-failed') {
        setError({ code: 'session-only' });
      } else setMessage('general-saved');
    } catch {
      setError({ code: 'general-save-failed' });
    } finally {
      finishAction();
    }
  };

  const runPause = async (minutes: 30 | 60 | 120): Promise<void> => {
    if (isActivePauseRuntime(controller.getSnapshot().scheduler, now()) || !beginAction()) return;
    try { await controller.pause(minutes); } catch { setError({ code: 'pause-failed' }); } finally { finishAction(); }
  };

  const resume = async (): Promise<void> => {
    if (!beginAction()) return;
    try { await controller.resumePause(); } catch { setError({ code: 'resume-failed' }); } finally { finishAction(); }
  };

  const requestNotifications = async (): Promise<void> => {
    if (snapshot.notificationStatus !== 'default' || !beginAction()) return;
    try { await controller.requestNotifications(); } catch { setError({ code: 'notification-request-failed' }); } finally { finishAction(); }
  };

  const confirmReset = async (): Promise<void> => {
    if (inFlightRef.current) return;
    setError(undefined);
    setMessage(undefined);
    setResetError(undefined);
    if (!acknowledged) {
      setResetError('acknowledge-required');
      return;
    }
    if (!beginAction()) return;
    try {
      await controller.clearAll();
      setResetOpen(false);
    } catch {
      setResetError('reset-failed');
    } finally {
      finishAction();
    }
  };

  const closeReset = useCallback((): void => {
    if (inFlightRef.current) return;
    setResetOpen(false);
    queueMicrotask(() => resetTriggerRef.current?.focus());
  }, []);

  return (
    <section className="settings-page" aria-labelledby={`${section}-settings-heading`}>
      {section === 'reminders' ? (
        <>
          <h1 id="reminders-settings-heading">{t('settings.reminders.heading')}</h1>
          <form className="settings-form" onSubmit={(event) => void saveReminderSettings(event)} noValidate>
            <div className="settings-grid">
              {reminderTypes.map((type) => {
                const label = reminderLabel(type);
                return (
                  <fieldset className="settings-card" key={type}>
                    <legend>{label}</legend>
                    <label><input type="checkbox" checked={reminders[type].enabled} onChange={(event) => updateReminder(type, { enabled: event.target.checked })} />{t('settings.reminder.enable', { label })}</label>
                    <label>{t('settings.reminder.intervalLabel', { label })}<input inputMode="numeric" value={reminders[type].interval} onChange={(event) => updateReminder(type, { interval: event.target.value })} /></label>
                    {actionDurationTypes.has(type) && (
                      <label>{t('settings.reminder.actionDurationLabel', { label })}<input inputMode="numeric" value={reminders[type].actionDuration} onChange={(event) => updateReminder(type, { actionDuration: event.target.value })} /></label>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <CustomReminderSettings now={now} />
            <fieldset className="settings-card quiet-settings">
              <legend>{t('settings.quiet.heading')}</legend>
              <label><input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />{t('settings.quiet.enable')}</label>
              <label>{t('settings.quiet.start')}<input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></label>
              <label>{t('settings.quiet.end')}<input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></label>
              <p>{t('settings.quiet.help')}</p>
            </fieldset>
            {error !== undefined && <p role="alert" className="settings-error">{errorText(error)}</p>}
            {message !== undefined && <p role="status">{messageText(message)}</p>}
            <button type="submit" disabled={pending}>{t('settings.reminders.save')}</button>
          </form>
          <section className="pause-controls" aria-labelledby="pause-heading">
            <h2 id="pause-heading">{t('settings.pause.heading')}</h2>
            <div className="button-row">
              {([30, 60, 120] as const).map((minutes) => <button key={minutes} type="button" disabled={pending || activePause} onClick={() => void runPause(minutes)}>{t('settings.pause.duration', { minutes })}</button>)}
            </div>
            {activePause && snapshot.scheduler.pausedUntil !== undefined && (
              <p>{t('settings.pause.until', { time: formatTime(snapshot.scheduler.pausedUntil) })} <button type="button" disabled={pending} onClick={() => void resume()}>{t('settings.pause.resume')}</button></p>
            )}
          </section>
        </>
      ) : (
        <>
          <h1 id="general-settings-heading">{t('settings.general.heading')}</h1>
          <form className="settings-form" onSubmit={(event) => void saveGeneralSettings(event)}>
            <fieldset className="settings-card">
              <legend>{t('settings.language')}</legend>
              {(['zh-CN', 'en'] as const).map((value) => (
                <label key={value}>
                  <input
                    ref={(node) => {
                      if (node === null) localeRadiosRef.current.delete(value);
                      else localeRadiosRef.current.set(value, node);
                    }}
                    type="radio"
                    name="locale"
                    value={value}
                    checked={locale === value}
                    disabled={localePending}
                    onChange={() => void changeLocale(value)}
                  />
                  {t(value === 'zh-CN' ? 'settings.language.zh' : 'settings.language.en')}
                </label>
              ))}
            </fieldset>
            <fieldset className="settings-card"><legend>{t('settings.theme.heading')}</legend>{([['light', 'settings.theme.light'], ['dark', 'settings.theme.dark'], ['system', 'settings.theme.system']] as const).map(([value, label]) => <label key={value}><input type="radio" name="theme" checked={theme === value} onChange={() => setTheme(value)} />{t(label)}</label>)}</fieldset>
            <fieldset className="settings-card"><legend>{t('settings.experience.heading')}</legend><label><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />{t('settings.experience.sound')}</label><label><input type="checkbox" checked={animationsEnabled} onChange={(event) => setAnimationsEnabled(event.target.checked)} />{t('settings.experience.animations')}</label></fieldset>
            <section className="settings-card" aria-labelledby="notification-heading"><h2 id="notification-heading">{t('settings.notifications.heading')}</h2><p aria-live="polite">{t(notificationCopy[snapshot.notificationStatus])}</p>{snapshot.notificationStatus === 'default' && <button type="button" disabled={pending} onClick={() => void requestNotifications()}>{t('settings.notifications.enable')}</button>}</section>
            {error !== undefined && <p role="alert" className="settings-error">{errorText(error)}</p>}
            {message !== undefined && <p role="status">{messageText(message)}</p>}
            <button type="submit" disabled={pending}>{t('settings.general.save')}</button>
          </form>
          <p className="sound-credit"><a href="https://elevenlabs.io/zh/sound-effects/kittens-meowing">{t('settings.soundCredit')}</a></p>
          <section className="settings-card danger-zone" aria-labelledby="data-heading"><h2 id="data-heading">{t('settings.data.heading')}</h2><p>{t('settings.data.description')}</p><button ref={resetTriggerRef} type="button" disabled={pending} onClick={() => { setResetOpen(true); setAcknowledged(false); setResetError(undefined); }}>{t('settings.data.clear')}</button></section>
          {resetOpen && <ResetDialog acknowledged={acknowledged} pending={pending} {...(resetError === undefined ? {} : { error: resetErrorText(resetError) })} onAcknowledged={setAcknowledged} onConfirm={() => void confirmReset()} onClose={closeReset} />}
        </>
      )}
    </section>
  );
}

interface ResetDialogProps {
  acknowledged: boolean;
  pending: boolean;
  error?: string;
  onAcknowledged(value: boolean): void;
  onConfirm(): void;
  onClose(): void;
}

function ResetDialog({ acknowledged, pending, error, onAcknowledged, onConfirm, onClose }: ResetDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell === null) return undefined;
    const wasInert = shell.hasAttribute('inert');
    shell.setAttribute('inert', '');
    return () => {
      if (wasInert) shell.setAttribute('inert', '');
      else shell.removeAttribute('inert');
    };
  }, []);
  useEffect(() => {
    if (pending) dialogRef.current?.focus();
    else cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        if (focusable.length === 0) { event.preventDefault(); dialog?.focus(); return; }
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
        if (activeIndex === -1) {
          event.preventDefault();
          (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
          return;
        }
        event.preventDefault();
        const nextIndex = event.shiftKey
          ? (activeIndex - 1 + focusable.length) % focusable.length
          : (activeIndex + 1) % focusable.length;
        focusable[nextIndex]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, pending]);
  return createPortal(
    <div className="modal-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-heading">
        <h2 id="reset-heading">{t('settings.reset.heading')}</h2>
        <p>{t('settings.reset.description')}</p>
        <label><input type="checkbox" checked={acknowledged} disabled={pending} onChange={(event) => onAcknowledged(event.target.checked)} />{t('settings.reset.acknowledge')}</label>
        {error !== undefined && <p role="alert" className="settings-error">{error}</p>}
        <div className="button-row"><button ref={cancelRef} type="button" disabled={pending} onClick={onClose}>{t('settings.reset.cancel')}</button><button type="button" disabled={pending} onClick={onConfirm}>{pending ? t('settings.reset.deleting') : t('settings.reset.confirm')}</button></div>
      </section>
    </div>,
    document.body,
  );
}
