import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AppSettings } from '../../app/model';
import {
  getCatReminderCopy,
  getReminderActionCopy,
  getReminderLabel,
} from '../../features/reminders/domain/presentation';
import { translate } from '../../i18n/messages';
import { parseAndroidHostSnapshot, type AndroidHostSnapshot } from '../domain/overlayProtocol';

interface NativeSurfaceBridge {
  postMessage(messageJson: string): void;
}

type SurfaceMode = 'MENU' | 'BUBBLE';
type SurfaceSide = 'left' | 'right';

type ActiveSurface =
  | {
    mode: 'MENU';
    side: SurfaceSide;
    generation: number;
  }
  | {
    mode: 'BUBBLE';
    side: SurfaceSide;
    generation: number;
  };

type SurfaceReadyMessage = {
  type: 'surface-ready';
  mode: SurfaceMode;
  generation: number;
};
type SurfaceSizeChangedMessage = {
  type: 'surface-size-changed';
  mode: SurfaceMode;
  generation: number;
  widthDp: number;
  heightDp: number;
};
type MenuSurfaceAction = {
  type: 'surface-action';
  mode: 'MENU';
  generation: number;
  action: 'close' | 'settings' | 'hide' | 'quit';
};
type BubbleCompletionAction = {
  type: 'surface-action';
  mode: 'BUBBLE';
  generation: number;
  action: 'complete' | 'skip';
  reminderId: string;
};
type BubbleSnoozeAction = {
  type: 'surface-action';
  mode: 'BUBBLE';
  generation: number;
  action: 'snooze';
  reminderId: string;
  snoozeMinutes: 5 | 10 | 15;
};

export type AndroidDetachedSurfaceOutboundMessage =
  | SurfaceReadyMessage
  | SurfaceSizeChangedMessage
  | MenuSurfaceAction
  | BubbleCompletionAction
  | BubbleSnoozeAction;

interface AndroidDetachedSurfaceMessageHost {
  postMessage(message: AndroidDetachedSurfaceOutboundMessage): void;
}

type UnknownObject = {
  [key: string]: unknown;
};

interface DetachedSurfaceIdentity {
  mode: SurfaceMode;
  generation: number;
  readyKey: string;
}

let surfaceReadySentFor: string | null = null;

interface LegacyActiveSurface {
  mode: SurfaceMode;
  side: SurfaceSide;
  generation: number;
}

type NativeSurfaceMessage =
  | { type: 'state-changed'; snapshot: unknown }
  | { type: 'open-menu'; mode: 'MENU'; side: SurfaceSide; generation: number }
  | { type: 'show-reminder'; mode: 'BUBBLE'; side: SurfaceSide; generation: number }
  | { type: 'close-surface'; mode: SurfaceMode; generation: number };

declare global {
  interface Window {
    AndroidOverlay?: NativeSurfaceBridge;
  }
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSurfaceSide(value: unknown): value is SurfaceSide {
  return value === 'left' || value === 'right';
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNativeSurfaceMessage(value: unknown): value is NativeSurfaceMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'state-changed') return 'snapshot' in value;
  if (value.type === 'open-menu') {
    return value.mode === 'MENU' && isSurfaceSide(value.side) && isGeneration(value.generation);
  }
  if (value.type === 'show-reminder') {
    return value.mode === 'BUBBLE' && isSurfaceSide(value.side) && isGeneration(value.generation);
  }
  return value.type === 'close-surface'
    && (value.mode === 'MENU' || value.mode === 'BUBBLE')
    && isGeneration(value.generation);
}

function readSettings(snapshot: AndroidHostSnapshot | null): AppSettings | null {
  if (snapshot?.settingsJson === null || snapshot === null) return null;
  try {
    return JSON.parse(snapshot.settingsJson) as AppSettings;
  } catch {
    return null;
  }
}

export function isAndroidDetachedSurfaceRoute(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.getAll('overlay').length === 1 && params.get('overlay') === 'surface';
}

export function parseAndroidDetachedSurfaceIdentity(search: string): DetachedSurfaceIdentity | null {
  const params = new URLSearchParams(search);
  if (params.getAll('overlay').length !== 1 || params.get('overlay') !== 'surface') return null;
  if (params.getAll('mode').length !== 1 || params.getAll('generation').length !== 1) return null;
  const mode = params.get('mode');
  const generationText = params.get('generation');
  if ((mode !== 'MENU' && mode !== 'BUBBLE') || generationText === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(generationText)) return null;
  const generation = Number(generationText);
  if (!Number.isSafeInteger(generation)) return null;
  return {
    mode,
    generation,
    readyKey: `${mode}:${generation}:${params.get('instance') ?? ''}`,
  };
}

export function AndroidDetachedSurfaceApp() {
  const pageIdentity = useMemo(
    () => parseAndroidDetachedSurfaceIdentity(window.location.search),
    [],
  );
  const [snapshot, setSnapshot] = useState<AndroidHostSnapshot | null>(null);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const activeSurfaceRef = useRef<ActiveSurface | null>(null);
  const host = useMemo<AndroidDetachedSurfaceMessageHost>(() => ({
    postMessage(message) {
      window.AndroidOverlay?.postMessage(JSON.stringify(message));
    },
  }), []);
  const settings = readSettings(snapshot);
  const dueReminders = settings?.reminders
    .filter(({ enabled, status }) => enabled && status === 'due')
    .sort((left, right) => (
      (left.snoozedUntil ?? left.nextDueAt) - (right.snoozedUntil ?? right.nextDueAt)
      || left.id.localeCompare(right.id)
    )) ?? [];
  const dueReminder = dueReminders[0];
  const occurrenceKey = dueReminder === undefined
    ? undefined
    : `${dueReminder.id}:${dueReminder.snoozedUntil ?? dueReminder.nextDueAt}`;
  const locale = settings?.locale ?? 'en';

  const activate = useCallback((next: ActiveSurface | null) => {
    activeSurfaceRef.current = next;
    setActiveSurface(next);
  }, []);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (!isNativeSurfaceMessage(value)) return;
      if (value.type === 'state-changed') {
        try {
          setSnapshot(parseAndroidHostSnapshot(value.snapshot));
        } catch {
          // Ignore invalid native snapshots and keep the last known valid state.
        }
        return;
      }
      if (value.type === 'close-surface') {
        const current = activeSurfaceRef.current;
        if (current?.mode === value.mode && current.generation === value.generation) activate(null);
        return;
      }
      if (pageIdentity === null
        || value.mode !== pageIdentity.mode
        || value.generation !== pageIdentity.generation) return;
      activate({ mode: value.mode, side: value.side, generation: value.generation });
    };
    window.addEventListener('android-overlay-message', onMessage);
    if (pageIdentity !== null && surfaceReadySentFor !== pageIdentity.readyKey) {
      surfaceReadySentFor = pageIdentity.readyKey;
      host.postMessage({
        type: 'surface-ready',
        mode: pageIdentity.mode,
        generation: pageIdentity.generation,
      });
    }
    return () => window.removeEventListener('android-overlay-message', onMessage);
  }, [activate, host, pageIdentity]);

  useEffect(() => {
    setActionOpen(false);
    setSnoozeOpen(false);
    setActionPending(false);
  }, [activeSurface?.generation, activeSurface?.mode, occurrenceKey]);

  const reportSize = useCallback(() => {
    const surface = surfaceRef.current;
    const current = activeSurfaceRef.current;
    if (surface === null || activeSurface === null || current === null
      || current.mode !== activeSurface.mode || current.generation !== activeSurface.generation) return;
    const bounds = surface.getBoundingClientRect();
    const width = Math.max(bounds.width, surface.scrollWidth);
    const height = Math.max(bounds.height, surface.scrollHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    host.postMessage({
      type: 'surface-size-changed',
      mode: activeSurface.mode,
      generation: activeSurface.generation,
      widthDp: Math.ceil(width),
      heightDp: Math.ceil(height),
    });
  }, [activeSurface, host]);

  useLayoutEffect(() => {
    if (activeSurface === null) return undefined;
    reportSize();
    const surface = surfaceRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reportSize);
    if (surface !== null) observer?.observe(surface);
    return () => observer?.disconnect();
  }, [actionOpen, activeSurface, occurrenceKey, reportSize, snoozeOpen]);

  const sendMenuAction = useCallback((action: MenuSurfaceAction['action']) => {
    const current = activeSurfaceRef.current;
    if (activeSurface?.mode !== 'MENU' || current?.mode !== 'MENU'
      || current.generation !== activeSurface.generation) return;
    host.postMessage({
      type: 'surface-action',
      mode: 'MENU',
      generation: activeSurface.generation,
      action,
    });
  }, [activeSurface, host]);

  const sendBubbleAction = useCallback((action: BubbleCompletionAction['action'], reminderId: string) => {
    const current = activeSurfaceRef.current;
    if (activeSurface?.mode !== 'BUBBLE' || current?.mode !== 'BUBBLE'
      || current.generation !== activeSurface.generation) return;
    host.postMessage({
      type: 'surface-action',
      mode: 'BUBBLE',
      generation: activeSurface.generation,
      action,
      reminderId,
    });
  }, [activeSurface, host]);

  const sendSnoozeAction = useCallback((reminderId: string, snoozeMinutes: BubbleSnoozeAction['snoozeMinutes']) => {
    const current = activeSurfaceRef.current;
    if (activeSurface?.mode !== 'BUBBLE' || current?.mode !== 'BUBBLE'
      || current.generation !== activeSurface.generation) return;
    host.postMessage({
      type: 'surface-action',
      mode: 'BUBBLE',
      generation: activeSurface.generation,
      action: 'snooze',
      reminderId,
      snoozeMinutes,
    });
  }, [activeSurface, host]);

  const expand = activeSurface?.side === 'right' ? 'left' : 'right';

  return (
    <div
      ref={surfaceRef}
      className="android-detached-surface"
      data-android-detached-surface="true"
      data-expand={expand}
    >
      {activeSurface?.mode === 'MENU' && (
        <section className="android-detached-surface-menu" role="menu" data-expand={expand}>
          <button type="button" className="android-detached-surface-close" onClick={() => sendMenuAction('close')}>
            {translate(locale, 'pet.reminder.close')}
          </button>
          <button type="button" role="menuitem" onClick={() => sendMenuAction('settings')}>
            {translate(locale, 'android.overlayMenu.settings')}
          </button>
          <button type="button" role="menuitem" onClick={() => sendMenuAction('hide')}>
            {translate(locale, 'android.overlayMenu.hide')}
          </button>
          <button type="button" role="menuitem" onClick={() => sendMenuAction('quit')}>
            {translate(locale, 'android.overlayMenu.quit')}
          </button>
        </section>
      )}

      {activeSurface?.mode === 'BUBBLE' && dueReminder !== undefined && settings !== null && (
        <section
          className="android-detached-surface-reminder"
          role="dialog"
          aria-label={translate(settings.locale, 'pet.reminder.title', {
            label: getReminderLabel(dueReminder, settings.locale),
          })}
        >
          <strong>{getReminderLabel(dueReminder, settings.locale)}</strong>
          {dueReminders.length > 1 && (
            <p className="android-detached-surface-progress">
              {translate(settings.locale, 'pet.reminder.queueProgress', { current: 1, total: dueReminders.length })}
            </p>
          )}
          {actionOpen ? (
            <div className="android-detached-surface-action-card">
              <p>{getReminderActionCopy(dueReminder, settings.locale)}</p>
              <button
                type="button"
                disabled={actionPending}
                onClick={() => {
                  setActionPending(true);
                  sendBubbleAction('complete', dueReminder.id);
                }}
              >
                {translate(settings.locale, 'action.complete')}
              </button>
            </div>
          ) : (
            <>
              <p>{getCatReminderCopy(dueReminder, settings.locale)}</p>
              <div className="android-detached-surface-primary-actions">
                <button type="button" onClick={() => setActionOpen(true)}>
                  {translate(settings.locale, 'pet.reminder.doNow')}
                </button>
                <button type="button" onClick={() => setSnoozeOpen(true)}>
                  {translate(settings.locale, 'pet.reminder.later')}
                </button>
                <button
                  type="button"
                  disabled={actionPending}
                  onClick={() => {
                    setActionPending(true);
                    sendBubbleAction('skip', dueReminder.id);
                  }}
                >
                  {translate(settings.locale, 'pet.reminder.skip')}
                </button>
              </div>
              {snoozeOpen && (
                <div
                  className="android-detached-surface-snooze-actions"
                  role="group"
                  aria-label={translate(settings.locale, 'pet.reminder.laterOptions')}
                >
                  {([5, 10, 15] as const).map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      disabled={actionPending}
                      onClick={() => {
                        setActionPending(true);
                        sendSnoozeAction(dueReminder.id, minutes);
                      }}
                    >
                      {translate(settings.locale, 'pet.reminder.minutes', { minutes })}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
