export const ANDROID_STATE_SCHEMA_VERSION = 1 as const;
const SAFE_PET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_ASSET_PATH = /^pets\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/spritesheet\.webp$/;

export interface AndroidPetAsset {
  id: string;
  metadataJson: string;
  assetPath: string;
  spritesheetBase64: string;
}

export interface AndroidOverlayState {
  xRatio: number;
  yRatio: number;
  activePet?: AndroidPetAsset | undefined;
}

export interface AndroidHostSnapshot {
  schemaVersion: 1;
  settingsJson: string;
  historyJson: readonly string[];
  pets: readonly AndroidPetAsset[];
  overlay: AndroidOverlayState;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  try {
    if (!isRecord(JSON.parse(value) as unknown)) throw new Error(message);
  } catch {
    throw new Error(message);
  }
  return value;
}

function parsePetAsset(value: unknown): AndroidPetAsset {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !SAFE_PET_ID.test(value.id)
    || typeof value.assetPath !== 'string'
    || typeof value.spritesheetBase64 !== 'string') {
    throw new Error('invalid Android pet asset');
  }
  const assetMatch = SAFE_ASSET_PATH.exec(value.assetPath);
  if (assetMatch?.[1] !== value.id) throw new Error('invalid Android pet asset');
  return {
    id: value.id,
    metadataJson: parseJsonObject(value.metadataJson, 'invalid Android pet metadata JSON'),
    assetPath: value.assetPath,
    spritesheetBase64: value.spritesheetBase64,
  };
}

function repairRatio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

export function parseAndroidHostSnapshot(value: unknown): AndroidHostSnapshot {
  if (!isRecord(value) || value.schemaVersion !== ANDROID_STATE_SCHEMA_VERSION) {
    throw new Error('unsupported Android state schema');
  }
  if (!Array.isArray(value.historyJson) || !Array.isArray(value.pets) || !isRecord(value.overlay)) {
    throw new Error('invalid Android state snapshot');
  }
  const historyJson = value.historyJson.map((entry) => parseJsonObject(entry, 'invalid Android history JSON'));
  const pets = value.pets.map(parsePetAsset);
  let activePet: AndroidPetAsset | undefined;
  if (value.overlay.activePet !== undefined) {
    try {
      activePet = parsePetAsset(value.overlay.activePet);
    } catch {
      activePet = undefined;
    }
  }
  return {
    schemaVersion: ANDROID_STATE_SCHEMA_VERSION,
    settingsJson: parseJsonObject(value.settingsJson, 'invalid Android settings JSON'),
    historyJson,
    pets,
    overlay: {
      xRatio: repairRatio(value.overlay.xRatio, 0.82),
      yRatio: repairRatio(value.overlay.yRatio, 0.72),
      ...(activePet === undefined ? {} : { activePet }),
    },
  };
}

export function isSafeAndroidPetId(id: string): boolean {
  return SAFE_PET_ID.test(id);
}
