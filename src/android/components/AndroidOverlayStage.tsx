import type { CSSProperties } from 'react';
import type { AppSettings, PetSizePreference } from '../../app/model';
import type { CatAnimation } from '../../features/cat/sprite/atlas';
import { CatSprite } from '../../features/cat/sprite/CatSprite';
import type {
  PetFrameMetadata,
  SpriteVersion,
  StandardPetAnimation,
} from '../../features/pets/domain/types';
import { PetSprite } from '../../features/pets/sprite/PetSprite';
import type { AndroidHostSnapshot, AndroidPetAsset } from '../bridge/androidHost';

const LOCAL_FILE_ORIGIN = 'https://appassets.androidplatform.net/pet-assets/';
const petSizes: Record<PetSizePreference, number> = {
  small: 56,
  medium: 72,
  large: 96,
};

interface AndroidOverlayStageProps {
  snapshot: AndroidHostSnapshot;
  interaction?: AndroidPetInteraction;
}

export type AndroidPetInteraction =
  | { type: 'idle'; sequence: number }
  | { type: 'tap'; sequence: number }
  | { type: 'drag'; sequence: number; facing: 'left' | 'right' };

export function androidPetAnimation(
  imported: boolean,
  interaction: AndroidPetInteraction,
  waiting: boolean,
): CatAnimation | StandardPetAnimation {
  if (interaction.type === 'drag') {
    return imported ? `running-${interaction.facing}` : 'picked-up';
  }
  if (interaction.type === 'tap') return imported ? 'waving' : 'review';
  return waiting ? 'waiting' : 'idle';
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
  interaction = { type: 'idle', sequence: 0 },
}: AndroidOverlayStageProps) {
  const settings = readSettings(snapshot);
  const petSize = petSizes[settings?.petSize ?? 'medium'];
  const activePet = snapshot.overlay.activePet;
  const petMetadata = activePet === undefined ? null : readPetMetadata(activePet);
  const waiting = settings?.reminders.some(({ enabled, status }) => enabled && status === 'due') ?? false;
  const petStyle = {
    '--android-pet-size': `${petSize}px`,
  } as CSSProperties;
  const petAnimation = androidPetAnimation(activePet !== undefined, interaction, waiting);

  return (
    <div className="android-overlay-stage" data-testid="android-overlay-stage">
      <div
        className="android-overlay-pet"
        data-testid="android-pet"
        data-animation={petAnimation}
        aria-label={petMetadata?.displayName ?? settings?.cat.name ?? 'Momo'}
        style={petStyle}
      >
        {activePet !== undefined && petMetadata !== null ? (
          <PetSprite
            atlasUrl={`${LOCAL_FILE_ORIGIN}${activePet.assetPath}`}
            version={petMetadata.spriteVersion}
            animation={petAnimation as StandardPetAnimation}
            animate={settings?.animationsEnabled ?? true}
            frameMetadata={petMetadata.frameMetadata}
          />
        ) : (
          <CatSprite
            animation={petAnimation as CatAnimation}
            animate={settings?.animationsEnabled ?? true}
          />
        )}
      </div>
    </div>
  );
}
