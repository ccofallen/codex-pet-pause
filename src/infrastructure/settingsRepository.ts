import { createDefaultSettings } from '../app/defaults';
import type {
  AppSettings, PetSizePreference, RuntimeState, ThemeMode,
} from '../app/model';
import type { CatConfig } from '../features/cat/domain/types';
import { DEFAULT_PET_POSITION } from '../features/pets/domain/types';
import type { PetPosition } from '../features/pets/domain/types';
import type { Locale } from '../i18n/types';
import type {
  CustomReminder, PresetReminder, PresetReminderType, Reminder, ReminderStatus,
} from '../features/reminders/domain/types';

export interface SettingsRepository {
  load(): Promise<AppSettings | null>;
  save(value: AppSettings): Promise<void>;
  clear(): Promise<void>;
}

export const SETTINGS_KEY = 'neko-pause:settings';

type RecordValue = Record<string, unknown>;

const themes: readonly ThemeMode[] = ['light', 'dark', 'system'];
const petSizes: readonly PetSizePreference[] = ['small', 'medium', 'large'];
const presetTypes: readonly PresetReminderType[] = ['lookAway', 'drinkWater', 'standUp', 'takeBreak'];
const reservedIds = new Set<string>(presetTypes);
const MAX_CUSTOM_REMINDERS = 20;
const reminderStatuses: readonly ReminderStatus[] = ['scheduled', 'due', 'snoozed', 'disabled'];
const locales: readonly Locale[] = ['zh-CN', 'en'];

const isRecord = (value: unknown): value is RecordValue => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const enumValue = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => (
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback
);

const booleanValue = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const finiteValue = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const boundedInteger = (value: unknown, minimum: number, maximum: number, fallback: number): number => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback
);

function repairRuntime(value: unknown, fallback: RuntimeState): RuntimeState {
  const source = isRecord(value) ? value : {};
  const repaired: RuntimeState = {};
  const sourcePausedAt = source.pausedAt;
  const sourcePausedUntil = source.pausedUntil;
  const validSourcePause = typeof sourcePausedAt === 'number'
    && Number.isFinite(sourcePausedAt)
    && typeof sourcePausedUntil === 'number'
    && Number.isFinite(sourcePausedUntil)
    && sourcePausedAt <= sourcePausedUntil;
  const validFallbackPause = fallback.pausedAt !== undefined
    && Number.isFinite(fallback.pausedAt)
    && fallback.pausedUntil !== undefined
    && Number.isFinite(fallback.pausedUntil)
    && fallback.pausedAt <= fallback.pausedUntil;
  if (validSourcePause) {
    repaired.pausedAt = sourcePausedAt;
    repaired.pausedUntil = sourcePausedUntil;
  } else if (validFallbackPause) {
    repaired.pausedAt = fallback.pausedAt;
    repaired.pausedUntil = fallback.pausedUntil;
  }
  if (typeof source.quietStartedAt === 'number' && Number.isFinite(source.quietStartedAt)) {
    repaired.quietStartedAt = source.quietStartedAt;
  } else if (fallback.quietStartedAt !== undefined) {
    repaired.quietStartedAt = fallback.quietStartedAt;
  }
  return repaired;
}

function repairCat(value: unknown, fallback: CatConfig): CatConfig {
  const source = isRecord(value) ? value : {};
  const normalizedName = typeof source.name === 'string' ? source.name.trim() : '';
  const nameLength = Array.from(normalizedName).length;
  return { name: nameLength >= 1 && nameLength <= 20 ? normalizedName : fallback.name };
}

function repairActivePetId(value: unknown, fallback: string): string {
  const normalizedId = typeof value === 'string' ? value.trim() : '';
  const idLength = Array.from(normalizedId).length;
  return idLength >= 1 && idLength <= 64 ? normalizedId : fallback;
}

function repairPetPosition(value: unknown): PetPosition {
  const source = isRecord(value) ? value : {};
  const validRatio = (ratio: unknown, fallback: number): number => (
    typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1
      ? ratio
      : fallback
  );
  return {
    xRatio: validRatio(source.xRatio, DEFAULT_PET_POSITION.xRatio),
    yRatio: validRatio(source.yRatio, DEFAULT_PET_POSITION.yRatio),
  };
}

function repairSharedReminder<T extends Reminder>(value: unknown, fallback: T): T {
  const source = isRecord(value) ? value : {};
  const repaired = {
    ...fallback,
    enabled: booleanValue(source.enabled, fallback.enabled),
    intervalMinutes: boundedInteger(source.intervalMinutes, 1, 720, fallback.intervalMinutes),
    nextDueAt: finiteValue(source.nextDueAt, fallback.nextDueAt),
    status: enumValue(source.status, reminderStatuses, fallback.status),
  };
  if (typeof source.snoozedUntil === 'number' && Number.isFinite(source.snoozedUntil)) {
    return { ...repaired, snoozedUntil: source.snoozedUntil } as T;
  }
  const { snoozedUntil: _removed, ...withoutSnooze } = repaired;
  return withoutSnooze as T;
}

const validActionDuration = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 10
  && value <= 7200
);

function repairPresetReminder(value: unknown, fallback: PresetReminder): PresetReminder {
  const repaired = repairSharedReminder(value, fallback);
  const source = isRecord(value) ? value : {};
  return {
    ...repaired,
    kind: 'preset',
    type: fallback.type,
    ...(validActionDuration(source.optionalActionDurationSeconds)
      ? { optionalActionDurationSeconds: source.optionalActionDurationSeconds }
      : fallback.optionalActionDurationSeconds === undefined
        ? {}
        : { optionalActionDurationSeconds: fallback.optionalActionDurationSeconds }),
  };
}

function repairCustomReminder(value: unknown, usedIds: Set<string>, now: number): CustomReminder | undefined {
  if (!isRecord(value) || value.kind !== 'custom' || typeof value.id !== 'string') return undefined;
  const id = value.id.trim();
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (id.length === 0 || id.length > 64 || reservedIds.has(id) || usedIds.has(id)) return undefined;
  if (Array.from(label).length < 1 || Array.from(label).length > 40) return undefined;
  const intervalMinutes = boundedInteger(value.intervalMinutes, 1, 720, 0);
  if (intervalMinutes === 0) return undefined;
  const fallback: CustomReminder = {
    id,
    kind: 'custom',
    label,
    enabled: false,
    intervalMinutes,
    nextDueAt: now + intervalMinutes * 60_000,
    status: 'disabled',
  };
  const repaired = repairSharedReminder(value, fallback);
  usedIds.add(id);
  return { ...repaired, kind: 'custom', label };
}

function presetReminderByType(reminders: readonly Reminder[]): Map<PresetReminderType, PresetReminder> {
  const byType = new Map<PresetReminderType, PresetReminder>();
  for (const reminder of reminders) {
    if (reminder.kind === 'preset') byType.set(reminder.type, reminder);
  }
  return byType;
}

function repairSettings(value: RecordValue, now: number, defaultLocale: Locale): AppSettings {
  const fallback = createDefaultSettings(now, defaultLocale);
  const repairedLocale = value.schemaVersion === 4 || value.schemaVersion === 5
    ? enumValue(value.locale, locales, defaultLocale)
    : 'zh-CN';
  const quietHours = isRecord(value.quietHours) ? value.quietHours : {};
  const reminderValues = Array.isArray(value.reminders) ? value.reminders : [];
  const reminderByIdentity = new Map<PresetReminderType, unknown>();
  for (const candidate of reminderValues) {
    if (!isRecord(candidate)) continue;
    const type = candidate.type;
    if (typeof type !== 'string'
      || !presetTypes.includes(type as PresetReminderType)
      || candidate.id !== type
      || reminderByIdentity.has(type as PresetReminderType)) continue;
    reminderByIdentity.set(type as PresetReminderType, candidate);
  }
  const fallbackPresets = presetReminderByType(fallback.reminders);
  const repairedPresets = presetTypes.map((type) => repairPresetReminder(
    reminderByIdentity.get(type),
    fallbackPresets.get(type)!,
  ));
  const usedIds = new Set<string>();
  const repairedCustoms: CustomReminder[] = [];
  for (const candidate of reminderValues) {
    if (repairedCustoms.length >= MAX_CUSTOM_REMINDERS) break;
    const repaired = repairCustomReminder(candidate, usedIds, now);
    if (repaired !== undefined) repairedCustoms.push(repaired);
  }
  return {
    schemaVersion: 5,
    locale: repairedLocale,
    onboardingComplete: booleanValue(value.onboardingComplete, fallback.onboardingComplete),
    theme: enumValue(value.theme, themes, fallback.theme),
    petSize: enumValue(value.petSize, petSizes, fallback.petSize),
    soundEnabled: booleanValue(value.soundEnabled, fallback.soundEnabled),
    animationsEnabled: booleanValue(value.animationsEnabled, fallback.animationsEnabled),
    affinity: Math.min(100, Math.max(0, finiteValue(value.affinity, fallback.affinity))),
    quietHours: {
      enabled: booleanValue(quietHours.enabled, fallback.quietHours.enabled),
      startMinutes: boundedInteger(quietHours.startMinutes, 0, 1439, fallback.quietHours.startMinutes),
      endMinutes: boundedInteger(quietHours.endMinutes, 0, 1439, fallback.quietHours.endMinutes),
    },
    runtime: repairRuntime(value.runtime, fallback.runtime),
    cat: repairCat(value.cat, fallback.cat),
    activePetId: repairActivePetId(value.activePetId, fallback.activePetId),
    petPosition: repairPetPosition(value.petPosition),
    reminders: [...repairedPresets, ...repairedCustoms],
  };
}

export function createBrowserSettingsRepository(
  storage: Storage,
  defaultLocale: Locale = 'zh-CN',
): SettingsRepository {
  return {
    async load(): Promise<AppSettings | null> {
      const serialized = storage.getItem(SETTINGS_KEY);
      if (serialized === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized) as unknown;
      } catch {
        return null;
      }
      const now = Date.now();
      return isRecord(parsed)
        ? repairSettings(parsed, now, defaultLocale)
        : createDefaultSettings(now, defaultLocale);
    },

    async save(value: AppSettings): Promise<void> {
      storage.setItem(SETTINGS_KEY, JSON.stringify(value));
    },

    async clear(): Promise<void> {
      storage.removeItem(SETTINGS_KEY);
    },
  };
}
