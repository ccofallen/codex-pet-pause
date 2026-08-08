import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import type { AppSettings, PetSizePreference } from '../../app/model';
import { CatSprite } from '../../features/cat/sprite/CatSprite';
import type { PetFrameMetadata, SpriteVersion } from '../../features/pets/domain/types';
import { PetSprite } from '../../features/pets/sprite/PetSprite';
import { getCatReminderCopy, getReminderLabel } from '../../features/reminders/domain/presentation';
import type { AndroidHostSnapshot, AndroidPetAsset } from '../bridge/androidHost';

const LOCAL_FILE_ORIGIN = 'https://appassets.androidplatform.net/local-files/';
const petSizes: Record<PetSizePreference, number> = {
  small: 56,
  medium: 72,
  large: 96,
};

export type AndroidOverlayOutboundMessage =
  | { type: 'overlay-ready' }
  | { type: 'menu-action'; action: 'settings' | 'hide' | 'quit' }
  | { type: 'bubble-size-changed'; widthDp: number; heightDp: number };

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
  const dueReminder = settings?.reminders.find(({ status }) => status === 'due');
  const expand = side === 'right' ? 'left' : 'right';

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null || (!menuOpen && !bubbleOpen)) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    host.postMessage({
      type: 'bubble-size-changed',
      widthDp: Math.ceil(bounds.width),
      heightDp: Math.ceil(bounds.height),
    });
  }, [bubbleOpen, host, menuOpen]);

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
            Settings
          </button>
          <button type="button" role="menuitem" onClick={() => host.postMessage({ type: 'menu-action', action: 'hide' })}>
            Hide
          </button>
          <button type="button" role="menuitem" onClick={() => host.postMessage({ type: 'menu-action', action: 'quit' })}>
            Quit
          </button>
        </div>
      )}

      {bubbleOpen && dueReminder !== undefined && settings !== null && (
        <section
          className="android-overlay-reminder"
          role="dialog"
          aria-label={getReminderLabel(dueReminder, settings.locale)}
        >
          <strong>{getReminderLabel(dueReminder, settings.locale)}</strong>
          <p>{getCatReminderCopy(dueReminder, settings.locale)}</p>
        </section>
      )}
    </div>
  );
}
