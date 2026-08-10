import type { ActivityEvent, AppSettings } from '../../app/model';
import type { HistoryRepository } from '../../infrastructure/historyRepository';
import type { PetRepository } from '../../infrastructure/petRepository';
import type { SettingsRepository } from '../../infrastructure/settingsRepository';
import type { CatalogCodexPet, StoredCodexPet } from '../../features/pets/domain/types';
import type { AndroidRuntimeRepository } from './androidRuntimeRepository';
import type { AndroidHost, AndroidHostSnapshot, AndroidPetWrite } from '../bridge/androidHost';

export interface AndroidSnapshotReader {
  load(): Promise<AndroidHostSnapshot | null>;
  invalidate(): void;
}

export function createAndroidSnapshotReader(host: AndroidHost): AndroidSnapshotReader {
  let cached: Promise<AndroidHostSnapshot | null> | undefined;
  return {
    load(): Promise<AndroidHostSnapshot | null> {
      cached ??= host.loadSnapshot();
      return cached;
    },
    invalidate(): void {
      cached = undefined;
    },
  };
}

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

function parsePet(asset: { id: string; metadataJson: string; spritesheetBase64?: string }): StoredCodexPet {
  if (typeof asset.spritesheetBase64 !== 'string') {
    throw new Error('Android pet spritesheet unavailable');
  }
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

function parseCatalogPet(asset: {
  id: string;
  metadataJson: string;
  assetRevision: string;
  thumbnailBase64: string | null;
}): CatalogCodexPet {
  const metadata = parseRecord(asset.metadataJson, 'invalid Android pet metadata');
  if (metadata.id !== asset.id
    || typeof metadata.displayName !== 'string'
    || (metadata.spriteVersion !== 1 && metadata.spriteVersion !== 2)
    || typeof metadata.spritesheetFilename !== 'string'
    || typeof metadata.importedAt !== 'number'
    || typeof metadata.updatedAt !== 'number') {
    throw new Error('invalid Android pet metadata');
  }
  const thumbnail = asset.thumbnailBase64 === null
    ? undefined
    : new Blob([decodeBase64(asset.thumbnailBase64)], { type: 'image/png' });
  return {
    ...metadata,
    id: asset.id,
    assetKind: 'catalog',
    atlasRevision: asset.assetRevision,
    ...(thumbnail === undefined ? {} : { thumbnail }),
  } as CatalogCodexPet;
}

export function parseAndroidCommittedAppState(snapshot: AndroidHostSnapshot): {
  revision: number;
  settings: AppSettings;
  pets: StoredCodexPet[];
} {
  if (snapshot.settingsJson === null) throw new Error('Committed Android state has no settings');
  const settings = parseRecord(snapshot.settingsJson, 'invalid Android settings');
  if (settings.schemaVersion !== 5) throw new Error('invalid Android settings');
  return {
    revision: snapshot.runtimeRevision ?? 0,
    settings: settings as unknown as AppSettings,
    pets: snapshot.pets.map(parsePet),
  };
}

export function createAndroidSettingsRepository(
  host: AndroidHost,
  createInitialSettings?: () => AppSettings,
  snapshotReader: AndroidSnapshotReader = createAndroidSnapshotReader(host),
): SettingsRepository {
  return {
    async load(): Promise<AppSettings | null> {
      const snapshot = await snapshotReader.load();
      if (snapshot === null || snapshot.settingsJson === null) {
        if (createInitialSettings === undefined) return null;
        const initial = createInitialSettings();
        await host.saveSettings(JSON.stringify(initial));
        snapshotReader.invalidate();
        return initial;
      }
      const value = parseRecord(snapshot.settingsJson, 'invalid Android settings');
      if (value.schemaVersion !== 5) throw new Error('invalid Android settings');
      return value as unknown as AppSettings;
    },
    async save(value: AppSettings): Promise<void> {
      await host.saveSettings(JSON.stringify(value));
      snapshotReader.invalidate();
    },
    async clear(): Promise<void> {
      await host.clearSettings();
      snapshotReader.invalidate();
    },
  };
}

export function createAndroidHistoryRepository(
  host: AndroidHost,
  snapshotReader: AndroidSnapshotReader = createAndroidSnapshotReader(host),
): HistoryRepository {
  return {
    async append(value: ActivityEvent): Promise<void> {
      await host.appendHistory(JSON.stringify(value));
      snapshotReader.invalidate();
    },
    async listSince(timestamp: number): Promise<ActivityEvent[]> {
      const snapshot = await snapshotReader.load();
      return snapshot === null ? [] : snapshot.historyJson
        .map(parseHistoryEvent)
        .filter((event) => event.occurredAt >= timestamp);
    },
    async prune(now): Promise<void> {
      await host.pruneHistory(now - 90 * 24 * 60 * 60 * 1000);
      snapshotReader.invalidate();
    },
    async clear(): Promise<void> {
      await host.clearHistory();
      snapshotReader.invalidate();
    },
  };
}

export function createAndroidPetRepository(
  host: AndroidHost,
  snapshotReader?: AndroidSnapshotReader,
): Omit<PetRepository, 'list'> & { list(): Promise<CatalogCodexPet[]> } {
  return {
    selectionFallbackAtomic: true,
    async list(): Promise<CatalogCodexPet[]> {
      if (host.loadPetCatalog === undefined) throw new Error('Android pet catalog unavailable');
      const catalog = await host.loadPetCatalog();
      return catalog === null ? [] : catalog.pets.map(parseCatalogPet);
    },
    async put(value: StoredCodexPet): Promise<void> {
      if (!(value?.spritesheet instanceof Blob)) throw new Error('full Android pet spritesheet required');
      const { spritesheet, ...metadata } = value;
      const bytes = new Uint8Array(await readAndroidBlobBytes(spritesheet));
      if (bytes.byteLength === 0) throw new Error("empty Android pet spritesheet");
      const input: AndroidPetWrite = {
        id: value.id,
        metadataJson: JSON.stringify(metadata),
        spritesheetBase64: encodeBase64(bytes),
      };
      await host.savePet(input);
      snapshotReader?.invalidate();
    },
    async delete(id: string): Promise<void> {
      await host.deletePet(id);
      snapshotReader?.invalidate();
    },
    async clear(): Promise<void> {
      await host.clearPets();
      snapshotReader?.invalidate();
    },
  };
}

export function createAndroidAppRepositories(
  host: AndroidHost,
  runtime: AndroidRuntimeRepository,
  createInitialSettings: () => AppSettings,
): { settings: SettingsRepository; history: HistoryRepository; pets: PetRepository } {
  const settings: SettingsRepository = {
    async load(): Promise<AppSettings> {
      const state = await runtime.load();
      if (state !== null) return state.settings;
      const initial = createInitialSettings();
      await host.saveSettings(JSON.stringify(initial));
      runtime.invalidate();
      return initial;
    },
    async save(value): Promise<void> {
      await host.saveSettings(JSON.stringify(value));
      runtime.invalidate();
    },
    async clear(): Promise<void> {
      await host.clearSettings();
      runtime.invalidate();
    },
  };
  const history: HistoryRepository = {
    async append(value): Promise<void> {
      await host.appendHistory(JSON.stringify(value));
      runtime.invalidate();
    },
    listSince: (timestamp) => runtime.listHistorySince(timestamp),
    async prune(now): Promise<void> {
      await host.pruneHistory(now - 90 * 24 * 60 * 60 * 1000);
      runtime.invalidate();
    },
    async clear(): Promise<void> {
      await host.clearHistory();
      runtime.invalidate();
    },
  };
  return {
    settings,
    history,
    pets: { ...createAndroidPetRepository(host), deferListUntilMounted: true },
  };
}
