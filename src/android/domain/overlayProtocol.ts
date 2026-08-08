export const ANDROID_STATE_SCHEMA_VERSION = 1 as const;
const SAFE_PET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_ASSET_PATH = /^pets\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/([a-f0-9]{32})\/spritesheet\.webp$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ACTIVITY_ACTIONS = new Set(['completed', 'snoozed', 'skipped']);
const REMINDER_TYPES = new Set(['lookAway', 'drinkWater', 'standUp', 'takeBreak']);

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
  settingsJson: string | null;
  historyJson: readonly string[];
  pets: readonly AndroidPetAsset[];
  overlay: AndroidOverlayState;
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: unknown, message: string): RecordValue {
  if (typeof value !== 'string') throw new Error(message);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error(message);
    return parsed;
  } catch {
    throw new Error(message);
  }
}

export function validateAndroidSettingsJson(value: unknown): string {
  const parsed = parseJsonRecord(value, 'invalid Android settings JSON');
  const quietHours = parsed.quietHours;
  const runtime = parsed.runtime;
  const cat = parsed.cat;
  const petPosition = parsed.petPosition;
  if (parsed.schemaVersion !== 5
    || (parsed.locale !== 'zh-CN' && parsed.locale !== 'en')
    || typeof parsed.onboardingComplete !== 'boolean'
    || !['light', 'dark', 'system'].includes(parsed.theme as string)
    || !['small', 'medium', 'large'].includes(parsed.petSize as string)
    || typeof parsed.soundEnabled !== 'boolean'
    || typeof parsed.animationsEnabled !== 'boolean'
    || !finiteInRange(parsed.affinity, 0, 100)
    || !isRecord(quietHours)
    || typeof quietHours.enabled !== 'boolean'
    || !integerInRange(quietHours.startMinutes, 0, 1439)
    || !integerInRange(quietHours.endMinutes, 0, 1439)
    || !validRuntime(runtime)
    || !isRecord(cat) || !trimmedCodePointLength(cat.name, 1, 20)
    || !trimmedCodePointLength(parsed.activePetId, 1, 64)
    || !isRecord(petPosition)
    || !finiteInRange(petPosition.xRatio, 0, 1)
    || !finiteInRange(petPosition.yRatio, 0, 1)
    || !validReminders(parsed.reminders)) {
    throw new Error('invalid Android settings JSON');
  }
  return value as string;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return finiteInRange(value, minimum, maximum) && Number.isInteger(value);
}

function trimmedCodePointLength(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function optionalFinite(value: RecordValue, key: string): boolean {
  return value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function validRuntime(value: unknown): boolean {
  if (!isRecord(value) || !optionalFinite(value, 'pausedAt')
    || !optionalFinite(value, 'pausedUntil') || !optionalFinite(value, 'quietStartedAt')) return false;
  const hasPausedAt = value.pausedAt !== undefined;
  const hasPausedUntil = value.pausedUntil !== undefined;
  return hasPausedAt === hasPausedUntil
    && (!hasPausedAt || (value.pausedAt as number) <= (value.pausedUntil as number));
}

function validReminders(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4 || value.length > 24) return false;
  const ids = new Set<string>();
  const presets = new Set<string>();
  let customs = 0;
  for (const reminder of value) {
    if (!isRecord(reminder)
      || !trimmedCodePointLength(reminder.id, 1, 64)
      || ids.has(reminder.id)
      || typeof reminder.enabled !== 'boolean'
      || !integerInRange(reminder.intervalMinutes, 1, 720)
      || typeof reminder.nextDueAt !== 'number' || !Number.isFinite(reminder.nextDueAt)
      || !['scheduled', 'due', 'snoozed', 'disabled'].includes(reminder.status as string)
      || !optionalFinite(reminder, 'snoozedUntil')) return false;
    ids.add(reminder.id);
    if (reminder.kind === 'preset') {
      if (typeof reminder.type !== 'string' || !REMINDER_TYPES.has(reminder.type)
        || reminder.id !== reminder.type || presets.has(reminder.type)
        || (reminder.optionalActionDurationSeconds !== undefined
          && !integerInRange(reminder.optionalActionDurationSeconds, 10, 7200))) return false;
      presets.add(reminder.type);
    } else if (reminder.kind === 'custom') {
      customs += 1;
      if (customs > 20 || REMINDER_TYPES.has(reminder.id)
        || !trimmedCodePointLength(reminder.label, 1, 40)) return false;
    } else return false;
  }
  return [...REMINDER_TYPES].every((type) => presets.has(type));
}

export function validateAndroidActivityEventJson(value: unknown): string {
  const parsed = parseJsonRecord(value, 'invalid Android history JSON');
  if (typeof parsed.id !== 'string' || parsed.id.length === 0
    || typeof parsed.action !== 'string' || !ACTIVITY_ACTIONS.has(parsed.action)
    || typeof parsed.occurredAt !== 'number' || !Number.isFinite(parsed.occurredAt)
    || (parsed.reminderId !== undefined && typeof parsed.reminderId !== 'string')
    || (parsed.reminderLabel !== undefined && typeof parsed.reminderLabel !== 'string')
    || (parsed.reminderType !== undefined
      && (typeof parsed.reminderType !== 'string' || !REMINDER_TYPES.has(parsed.reminderType)))) {
    throw new Error('invalid Android history JSON');
  }
  return value as string;
}

export function validateAndroidPetMetadataJson(value: unknown, expectedId: string): string {
  const parsed = parseJsonRecord(value, 'invalid Android pet metadata JSON');
  if (parsed.id !== expectedId
    || typeof parsed.displayName !== 'string' || parsed.displayName.length === 0
    || (parsed.spriteVersion !== 1 && parsed.spriteVersion !== 2)
    || typeof parsed.spritesheetFilename !== 'string' || parsed.spritesheetFilename.length === 0
    || typeof parsed.importedAt !== 'number' || !Number.isFinite(parsed.importedAt)
    || typeof parsed.updatedAt !== 'number' || !Number.isFinite(parsed.updatedAt)
    || (parsed.description !== undefined && typeof parsed.description !== 'string')
    || (parsed.atlasRevision !== undefined && typeof parsed.atlasRevision !== 'string')
    || (parsed.frameMetadata !== undefined && !isRecord(parsed.frameMetadata))) {
    throw new Error('invalid Android pet metadata JSON');
  }
  return value as string;
}

export function validateAndroidSpritesheetBase64(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !CANONICAL_BASE64.test(value)) {
    throw new Error('invalid Android pet spritesheet');
  }
  try {
    const decoded = atob(value);
    if (decoded.length === 0 || btoa(decoded) !== value) throw new Error('invalid Android pet spritesheet');
  } catch {
    throw new Error('invalid Android pet spritesheet');
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
    metadataJson: validateAndroidPetMetadataJson(value.metadataJson, value.id),
    assetPath: value.assetPath,
    spritesheetBase64: validateAndroidSpritesheetBase64(value.spritesheetBase64),
  };
}

function repairRatio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

export function parseAndroidHostSnapshot(value: unknown): AndroidHostSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value) || value.schemaVersion !== ANDROID_STATE_SCHEMA_VERSION) {
    throw new Error('unsupported Android state schema');
  }
  if (!Array.isArray(value.historyJson) || !Array.isArray(value.pets) || !isRecord(value.overlay)) {
    throw new Error('invalid Android state snapshot');
  }
  const historyJson = value.historyJson.map(validateAndroidActivityEventJson);
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
    settingsJson: value.settingsJson === null ? null : validateAndroidSettingsJson(value.settingsJson),
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
