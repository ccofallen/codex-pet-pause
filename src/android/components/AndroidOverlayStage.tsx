import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { AppSettings, PetSizePreference } from '../../app/model';
import { CatSprite } from '../../features/cat/sprite/CatSprite';
import type { PetFrameMetadata, SpriteVersion } from '../../features/pets/domain/types';
import { PetSprite } from '../../features/pets/sprite/PetSprite';
import {
  getCatReminderCopy,
  getReminderActionCopy,
  getReminderLabel,
} from '../../features/reminders/domain/presentation';
import { translate } from '../../i18n/messages';
import type { AndroidHostSnapshot, AndroidPetAsset } from '../bridge/androidHost';

const LOCAL_FILE_ORIGIN = 'https://appassets.androidplatform.net/pet-assets/';
const petSizes: Record<PetSizePreference, number> = {
  small: 56,
  medium: 72,
  large: 96,
};

export type AndroidOverlayOutboundMessage =
  | { type: 'overlay-ready' }
  | { type: 'menu-action'; action: 'settings' | 'hide' | 'quit' }
  | { type: 'bubble-size-changed'; widthDp: number; heightDp: number }
  | { type: 'reminder-action'; action: 'complete' | 'skip'; reminderId: string }
  | { type: 'reminder-action'; action: 'snooze'; reminderId: string; snoozeMinutes: 5 | 10 | 15 };

export interface AndroidOverlayMessageHost {
  postMessage(message: AndroidOverlayOutboundMessage): void;
}

interface AndroidOverlayStageProps {
  snapshot: AndroidHostSnapshot;
  host: AndroidOverlayMessageHost;
  menuOpen?: boolean;
  bubbleOpen?: boolean;
  side?: 'left' | 'right';
}

interface PetMetadata {
  displayName: string;
  spriteVersion: SpriteVersion;
  frameMetadata?: PetFrameMetadata | undefined;
}

function readSettings(snapshot: AndroidHostSnapshot): AppSettings | null {
  if (snapshot.settingsJson === null) return null;
  try {
    return JSON.parse(snapshot.settingsJson) as AppSettings;
  } catch {
    return null;
  }
}

function readPetMetadata(asset: AndroidPetAsset): PetMetadata | null {
  try {
    const value = JSON.parse(asset.metadataJson) as Partial<PetMetadata>;
    if (typeof value.displayName !== 'string'
      || (value.spriteVersion !== 1 && value.spriteVersion !== 2)) return null;
    return {
      displayName: value.displayName,
      spriteVersion: value.spriteVersion,
      ...(value.frameMetadata === undefined ? {} : { frameMetadata: value.frameMetadata }),
    };
  } catch {
    return null;
  }
}

export function AndroidOverlayStage({
  snapshot,
  host,
  menuOpen = false,
  bubbleOpen = false,
  side = 'left',
}: AndroidOverlayStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const settings = readSettings(snapshot);
  const petSize = petSizes[settings?.petSize ?? 'medium'];
  const activePet = snapshot.overlay.activePet;
  const petMetadata = activePet === undefined ? null : readPetMetadata(activePet);
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
  const expand = side === 'right' ? 'left' : 'right';
  const [actionOpen, setActionOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    setActionOpen(false);
    setSnoozeOpen(false);
    setActionPending(false);
  }, [occurrenceKey]);

  const reportSize = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    host.postMessage({
      type: 'bubble-size-changed',
      widthDp: Math.ceil(bounds.width),
      heightDp: Math.ceil(bounds.height),
    });
  }, [host]);

  useLayoutEffect(() => {
    if (!menuOpen && !bubbleOpen) return undefined;
    reportSize();
    const stage = stageRef.current;
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(reportSize);
    if (stage !== null) observer?.observe(stage);
    return () => observer?.disconnect();
  }, [actionOpen, bubbleOpen, menuOpen, occurrenceKey, reportSize, snoozeOpen]);

  const petStyle = {
    '--android-pet-size': `${petSize}px`,
  } as CSSProperties;

  return (
    <div
      ref={stageRef}
      className="android-overlay-stage"
      data-expand={expand}
      data-testid="android-overlay-stage"
    >
      <div
        className="android-overlay-pet"
        data-testid="android-pet"
        aria-label={petMetadata?.displayName ?? settings?.cat.name ?? 'Momo'}
        style={petStyle}
      >
        {activePet !== undefined && petMetadata !== null ? (
          <PetSprite
            atlasUrl={`${LOCAL_FILE_ORIGIN}${activePet.assetPath}`}
            version={petMetadata.spriteVersion}
            animation="idle"
            animate={settings?.animationsEnabled ?? true}
            frameMetadata={petMetadata.frameMetadata}
          />
        ) : (
          <CatSprite
            animation="idle"
            animate={settings?.animationsEnabled ?? true}
          />
        )}
      </div>

      {menuOpen && (
        <div className="android-overlay-menu" role="menu" data-expand={expand}>
          <button type="button" role="menuitem" onClick={() => host.postMessage({ type: 'menu-action', action: 'settings' })}>
            {settings?.locale === 'zh-CN' ? '设置' : 'Settings'}
          </button>
          <button type="button" role="menuitem" onClick={() => host.postMessage({ type: 'menu-action', action: 'hide' })}>
            {settings?.locale === 'zh-CN' ? '隐藏' : 'Hide'}
          </button>
          <button type="button" role="menuitem" onClick={() => host.postMessage({ type: 'menu-action', action: 'quit' })}>
            {settings?.locale === 'zh-CN' ? '退出' : 'Quit'}
          </button>
        </div>
      )}

      {bubbleOpen && dueReminder !== undefined && settings !== null && (
        <section
          className="android-overlay-reminder"
          role="dialog"
          aria-label={translate(settings.locale, 'pet.reminder.title', {
            label: getReminderLabel(dueReminder, settings.locale),
          })}
        >
          <strong>{getReminderLabel(dueReminder, settings.locale)}</strong>
          {dueReminders.length > 1 && (
            <p className="android-reminder-progress">
              {translate(settings.locale, 'pet.reminder.queueProgress', {
                current: 1,
                total: dueReminders.length,
              })}
            </p>
          )}
          {actionOpen ? (
            <div className="android-reminder-action-card">
              <p>{getReminderActionCopy(dueReminder, settings.locale)}</p>
              <button
                type="button"
                disabled={actionPending}
                onClick={() => {
                  setActionPending(true);
                  host.postMessage({
                    type: 'reminder-action',
                    action: 'complete',
                    reminderId: dueReminder.id,
                  });
                }}
              >
                {translate(settings.locale, 'action.complete')}
              </button>
            </div>
          ) : (
            <>
              <p>{getCatReminderCopy(dueReminder, settings.locale)}</p>
              <div className="android-reminder-primary-actions">
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
                    host.postMessage({
                      type: 'reminder-action',
                      action: 'skip',
                      reminderId: dueReminder.id,
                    });
                  }}
                >
                  {translate(settings.locale, 'pet.reminder.skip')}
                </button>
              </div>
              {snoozeOpen && (
                <div
                  className="android-reminder-snooze-actions"
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
                        host.postMessage({
                          type: 'reminder-action',
                          action: 'snooze',
                          reminderId: dueReminder.id,
                          snoozeMinutes: minutes,
                        });
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
