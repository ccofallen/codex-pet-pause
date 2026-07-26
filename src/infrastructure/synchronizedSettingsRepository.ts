import type { AppSettings } from '../app/model';
import type { SettingsRepository } from './settingsRepository';

export const SETTINGS_REVISION_KEY = 'neko-pause:settings-revision';
export const SETTINGS_CONFLICT_RECOVERED_EVENT = 'neko-pause:settings-conflict-recovered';

const SETTINGS_WRITE_LOCK = 'neko-pause:settings-write';

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SynchronizedSettingsOptions {
  conflictPolicy?: 'reject' | 'replay-user-operation';
  locks?: LockManagerLike;
}

export class StaleSettingsWriteError extends Error {
  constructor() {
    super('stale settings write');
    this.name = 'StaleSettingsWriteError';
  }
}

let revisionSequence = 0;

function nextRevision(): string {
  revisionSequence += 1;
  return `${Date.now()}:${revisionSequence}:${Math.random()}`;
}

function browserLockManager(): LockManagerLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return typeof locks?.request === 'function' ? locks : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => key in right && valuesEqual(left[key], right[key]));
  }
  return false;
}

function isKeyedArray(value: unknown[]): value is Array<Record<string, unknown> & { id: string }> {
  return value.every((item) => isRecord(item) && typeof item.id === 'string');
}

function rebaseKeyedArray(
  baseline: Array<Record<string, unknown> & { id: string }>,
  latest: Array<Record<string, unknown> & { id: string }>,
  intent: Array<Record<string, unknown> & { id: string }>,
): unknown[] {
  const baselineById = new Map(baseline.map((item) => [item.id, item]));
  const latestById = new Map(latest.map((item) => [item.id, item]));
  const intentIds = new Set(intent.map((item) => item.id));
  const rebased = intent.flatMap((item) => {
    const original = baselineById.get(item.id);
    const current = latestById.get(item.id);
    if (original === undefined) return [item];
    if (current === undefined) return valuesEqual(item, original) ? [] : [item];
    return [rebaseValue(original, current, item)];
  });
  for (const item of latest) {
    if (!baselineById.has(item.id) && !intentIds.has(item.id)) rebased.push(item);
  }
  return rebased;
}

function rebaseValue(baseline: unknown, latest: unknown, intent: unknown): unknown {
  if (valuesEqual(intent, baseline)) return latest;
  if (Array.isArray(baseline) && Array.isArray(latest) && Array.isArray(intent)) {
    return isKeyedArray(baseline) && isKeyedArray(latest) && isKeyedArray(intent)
      ? rebaseKeyedArray(baseline, latest, intent)
      : intent;
  }
  if (!isRecord(baseline) || !isRecord(latest) || !isRecord(intent)) return intent;

  const rebased: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(latest), ...Object.keys(intent)]);
  for (const key of keys) {
    const baselineHas = key in baseline;
    const latestHas = key in latest;
    const intentHas = key in intent;
    if (!intentHas) {
      if (!baselineHas && latestHas) rebased[key] = latest[key];
      continue;
    }
    if (!baselineHas) {
      rebased[key] = intent[key];
      continue;
    }
    if (!latestHas) {
      if (!valuesEqual(intent[key], baseline[key])) rebased[key] = intent[key];
      continue;
    }
    rebased[key] = rebaseValue(baseline[key], latest[key], intent[key]);
  }
  return rebased;
}

function rebaseSettings(
  baseline: AppSettings,
  latest: AppSettings,
  intent: AppSettings,
): AppSettings {
  return rebaseValue(baseline, latest, intent) as AppSettings;
}

export function createSynchronizedSettingsRepository(
  repository: SettingsRepository,
  storage: Storage,
  options: SynchronizedSettingsOptions = {},
): SettingsRepository {
  const locks = options.locks ?? browserLockManager();
  const conflictPolicy = options.conflictPolicy ?? 'reject';
  let loadedRevision: string | null | undefined;
  let loadedSettings: AppSettings | null | undefined;

  const readRevision = (): string | null | undefined => {
    try {
      return storage.getItem(SETTINGS_REVISION_KEY);
    } catch {
      return undefined;
    }
  };

  const writeRevision = (): void => {
    const revision = nextRevision();
    try {
      storage.setItem(SETTINGS_REVISION_KEY, revision);
      loadedRevision = revision;
    } catch {
      loadedRevision = undefined;
    }
  };

  const assertCurrentRevision = (): void => {
    const currentRevision = readRevision();
    if (loadedRevision !== undefined
      && currentRevision !== undefined
      && currentRevision !== loadedRevision) {
      throw new StaleSettingsWriteError();
    }
  };

  const notifyConflictRecovered = (): void => {
    window.dispatchEvent(new Event(SETTINGS_CONFLICT_RECOVERED_EVENT));
  };

  const withWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (locks === undefined) return operation();
    let started = false;
    try {
      return await locks.request(SETTINGS_WRITE_LOCK, async () => {
        started = true;
        return operation();
      });
    } catch (error) {
      if (started) throw error;
      return operation();
    }
  };

  return {
    async load() {
      return withWriteLock(async () => {
        const settings = await repository.load();
        loadedRevision = readRevision();
        loadedSettings = settings;
        return settings;
      });
    },

    async save(settings) {
      await withWriteLock(async () => {
        try {
          assertCurrentRevision();
        } catch (error) {
          if (!(error instanceof StaleSettingsWriteError)
            || conflictPolicy !== 'replay-user-operation'
            || loadedSettings == null) throw error;
          const latest = await repository.load();
          if (latest === null) throw error;
          loadedRevision = readRevision();
          const rebased = rebaseSettings(loadedSettings, latest, settings);
          assertCurrentRevision();
          await repository.save(rebased);
          writeRevision();
          loadedSettings = rebased;
          notifyConflictRecovered();
          return;
        }
        await repository.save(settings);
        writeRevision();
        loadedSettings = settings;
      });
    },

    async clear() {
      await withWriteLock(async () => {
        try {
          assertCurrentRevision();
        } catch (error) {
          if (!(error instanceof StaleSettingsWriteError)
            || conflictPolicy !== 'replay-user-operation') throw error;
          await repository.load();
          loadedRevision = readRevision();
          assertCurrentRevision();
          await repository.clear();
          writeRevision();
          loadedSettings = null;
          notifyConflictRecovered();
          return;
        }
        await repository.clear();
        writeRevision();
        loadedSettings = null;
      });
    },
  };
}
