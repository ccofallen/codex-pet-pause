import type { ActivityEvent, AppSettings } from '../../app/model';
import type { HistoryRepository } from '../../infrastructure/historyRepository';
import type { PetRepository } from '../../infrastructure/petRepository';
import type { SettingsRepository } from '../../infrastructure/settingsRepository';
import type { StoredCodexPet } from '../../features/pets/domain/types';
import type { AndroidHost, AndroidPetWrite } from '../bridge/androidHost';

function parseRecord(value: string, message: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(message);
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(message);
  }
}

export function readAndroidBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  const candidate = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof candidate.arrayBuffer === "function") return candidate.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error("Could not read Android pet spritesheet"));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read Android pet spritesheet"));
    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      reject(error);
    }
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function decodeBase64(value: string): ArrayBuffer {
  try {
    const text = atob(value);
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    return bytes.buffer as ArrayBuffer;
  } catch {
    throw new Error('invalid Android pet spritesheet');
  }
}

function parseHistoryEvent(value: string): ActivityEvent {
  const parsed = parseRecord(value, 'invalid Android history event');
  if (typeof parsed.id !== 'string'
    || !['completed', 'snoozed', 'skipped'].includes(parsed.action as string)
    || typeof parsed.occurredAt !== 'number'
    || !Number.isFinite(parsed.occurredAt)) {
    throw new Error('invalid Android history event');
  }
  return parsed as unknown as ActivityEvent;
}

function parsePet(asset: { id: string; metadataJson: string; spritesheetBase64: string }): StoredCodexPet {
  const metadata = parseRecord(asset.metadataJson, 'invalid Android pet metadata');
  if (metadata.id !== asset.id
    || typeof metadata.displayName !== 'string'
    || (metadata.spriteVersion !== 1 && metadata.spriteVersion !== 2)
    || typeof metadata.spritesheetFilename !== 'string'
    || typeof metadata.importedAt !== 'number'
    || typeof metadata.updatedAt !== 'number') {
    throw new Error('invalid Android pet metadata');
  }
  return {
    ...metadata,
    id: asset.id,
    spritesheet: new Blob([decodeBase64(asset.spritesheetBase64)], { type: 'image/webp' }),
  } as StoredCodexPet;
}

export function createAndroidSettingsRepository(host: AndroidHost): SettingsRepository {
  return {
    async load(): Promise<AppSettings | null> {
      const snapshot = await host.loadSnapshot();
      if (snapshot === null) return null;
      const value = parseRecord(snapshot.settingsJson, 'invalid Android settings');
      if (value.schemaVersion !== 5) throw new Error('invalid Android settings');
      return value as unknown as AppSettings;
    },
    async save(value: AppSettings): Promise<void> {
      await host.saveSettings(JSON.stringify(value));
    },
    async clear(): Promise<void> {
      if (host.clearSettings === undefined) throw new Error("Android settings clear is unavailable");
      await host.clearSettings();
    },
  };
}

export function createAndroidHistoryRepository(host: AndroidHost): HistoryRepository {
  return {
    async append(value: ActivityEvent): Promise<void> {
      await host.appendHistory(JSON.stringify(value));
    },
    async listSince(timestamp: number): Promise<ActivityEvent[]> {
      const snapshot = await host.loadSnapshot();
      return snapshot === null ? [] : snapshot.historyJson
        .map(parseHistoryEvent)
        .filter((event) => event.occurredAt >= timestamp);
    },
    async prune(now): Promise<void> {
      const snapshot = await host.loadSnapshot();
      if (snapshot === null) return;
      if (host.replaceHistory === undefined) throw new Error("Android history replacement is unavailable");
      await host.replaceHistory(snapshot!.historyJson.filter((value) => parseHistoryEvent(value).occurredAt >= now - 90 * 24 * 60 * 60 * 1000));
    },
    async clear(): Promise<void> { if (host.clearHistory === undefined) throw new Error("Android history clear is unavailable");
      await host.clearHistory(); },
  };
}

export function createAndroidPetRepository(host: AndroidHost): PetRepository {
  return {
    async list(): Promise<StoredCodexPet[]> {
      const snapshot = await host.loadSnapshot();
      return snapshot === null ? [] : snapshot.pets.map(parsePet);
    },
    async put(value: StoredCodexPet): Promise<void> {
      const { spritesheet, ...metadata } = value;
      const bytes = new Uint8Array(await readAndroidBlobBytes(spritesheet));
      if (bytes.byteLength === 0) throw new Error("empty Android pet spritesheet");
      const input: AndroidPetWrite = {
        id: value.id,
        metadataJson: JSON.stringify(metadata),
        spritesheetBase64: encodeBase64(bytes),
      };
      await host.savePet(input);
    },
    async delete(id: string): Promise<void> {
      await host.deletePet(id);
    },
    async clear(): Promise<void> {
      if (host.clearPets === undefined) throw new Error("Android pet clear is unavailable");
      await host.clearPets();
    },
  };
}
