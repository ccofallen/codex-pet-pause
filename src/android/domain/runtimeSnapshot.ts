import type { ActivityEvent, AppSettings } from '../../app/model';
import {
  validateAndroidActivityEventJson,
  validateAndroidSettingsJson,
} from './overlayProtocol';

export interface AndroidRuntimeState {
  revision: number;
  settings: AppSettings;
  history: ActivityEvent[];
}

const RUNTIME_FIELDS = new Set(['schemaVersion', 'revision', 'settingsJson', 'historyJson']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function parseAndroidRuntimeSnapshot(value: unknown): AndroidRuntimeState | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('unsupported Android runtime schema');
  }
  if (Object.keys(value).some((field) => !RUNTIME_FIELDS.has(field))
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.historyJson)) {
    throw new Error('invalid Android runtime snapshot');
  }
  const settingsJson = validateAndroidSettingsJson(value.settingsJson);
  const historyJson = value.historyJson.map(validateAndroidActivityEventJson);
  return {
    revision: value.revision as number,
    settings: parseJson<AppSettings>(settingsJson),
    history: historyJson.map((event) => parseJson<ActivityEvent>(event)),
  };
}
