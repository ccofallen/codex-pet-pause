import { registerPlugin } from '@capacitor/core';
import {
  isSafeAndroidPetId,
  parseAndroidHostSnapshot,
  validateAndroidActivityEventJson,
  validateAndroidPetMetadataJson,
  validateAndroidSettingsJson,
  validateAndroidSpritesheetBase64,
  type AndroidHostSnapshot,
} from '../domain/overlayProtocol';

export type { AndroidHostSnapshot, AndroidPetAsset, AndroidOverlayState } from '../domain/overlayProtocol';

export interface AndroidPetWrite {
  id: string;
  metadataJson: string;
  spritesheetBase64: string;
}

export type AndroidNativePetMime = 'application/zip' | 'application/json' | 'image/webp';

export interface AndroidNativePetFile {
  name: string;
  mimeType: AndroidNativePetMime;
  base64: string;
}

export type AndroidPetFileSelection =
  | { status: 'cancelled'; files: [] }
  | { status: 'selected'; files: AndroidNativePetFile[] };

export interface AndroidPetArchiveEvent {
  type: 'pet-archive-ready';
  token: string;
}

export interface AndroidHostEvent {
  type: 'stateChanged';
  snapshot: AndroidHostSnapshot;
}

export type AndroidOverlayPermission = 'granted' | 'denied';
export type AndroidNotificationPermission =
  | 'notRequired'
  | 'notRequested'
  | 'deniedCanAsk'
  | 'blocked'
  | 'granted';

export interface AndroidCapabilities {
  apiLevel: number;
  overlayPermission: AndroidOverlayPermission;
  notificationPermission: AndroidNotificationPermission;
  serviceActive: boolean;
  petVisible: boolean;
}

export interface AndroidCapabilitiesEvent {
  type: 'capabilitiesChanged';
  capabilities: AndroidCapabilities;
}

export interface AndroidHost {
  loadSnapshot(): Promise<AndroidHostSnapshot | null>;
  clearSettings(): Promise<void>;
  replaceHistory(historyJson: readonly string[]): Promise<void>;
  clearHistory(): Promise<void>;
  clearPets(): Promise<void>;
  saveSettings(settingsJson: string): Promise<void>;
  appendHistory(eventJson: string): Promise<void>;
  savePet(input: AndroidPetWrite): Promise<void>;
  deletePet(id: string): Promise<void>;
  selectPet(id: string): Promise<void>;
  subscribe(listener: (event: AndroidHostEvent) => void): () => void;
}

export interface AndroidPetImportHost {
  openPetdex(): Promise<void>;
  pickPetFiles(): Promise<AndroidPetFileSelection>;
  consumePendingArchive(token: string): Promise<AndroidNativePetFile>;
  persistValidatedPet(input: AndroidPetWrite): Promise<void>;
  subscribePetArchives(listener: (event: AndroidPetArchiveEvent) => void): () => void;
}

export interface AndroidControlHost extends AndroidHost, AndroidPetImportHost {
  getCapabilities(): Promise<AndroidCapabilities>;
  requestNotifications(): Promise<AndroidCapabilities>;
  openNotificationSettings(): Promise<AndroidCapabilities>;
  openOverlaySettings(): Promise<AndroidCapabilities>;
  startService(): Promise<AndroidCapabilities>;
  showPet(): Promise<AndroidCapabilities>;
  hidePet(): Promise<AndroidCapabilities>;
  quit(): Promise<AndroidCapabilities>;
  subscribeCapabilities(listener: (event: AndroidCapabilitiesEvent) => void): () => void;
}

export interface AndroidHostPlugin {
  loadSnapshot(): Promise<unknown>;
  clearSettings(): Promise<void>;
  replaceHistory(options: { historyJson: string[] }): Promise<void>;
  clearHistory(): Promise<void>;
  clearPets(): Promise<void>;
  saveSettings(options: { json: string }): Promise<void>;
  appendHistory(options: { json: string }): Promise<void>;
  savePet(options: AndroidPetWrite): Promise<void>;
  deletePet(options: { id: string }): Promise<void>;
  selectPet(options: { id: string }): Promise<void>;
  getCapabilities?(): Promise<unknown>;
  requestNotifications?(): Promise<unknown>;
  openNotificationSettings?(): Promise<unknown>;
  openOverlaySettings?(): Promise<unknown>;
  startService?(): Promise<unknown>;
  showPet?(): Promise<unknown>;
  hidePet?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  openPetdex?(): Promise<void>;
  pickPetFiles?(): Promise<unknown>;
  consumePendingArchive?(options: { token: string }): Promise<unknown>;
  persistValidatedPet?(options: AndroidPetWrite): Promise<void>;
  addListener(
    eventName: 'stateChanged' | 'capabilitiesChanged' | 'petArchiveReady',
    listener: (event: unknown) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const SAFE_ARCHIVE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_NATIVE_FILE_NAME = /^[^/\\\0]{1,255}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_NATIVE_FILE_BASE64_CHARACTERS = 4 * Math.ceil((32 * 1024 * 1024) / 3);

function requireArchiveToken(token: string): void {
  if (!SAFE_ARCHIVE_TOKEN.test(token)) throw new Error('invalid Android archive token');
}

function parseNativePetFile(value: unknown): AndroidNativePetFile {
  if (typeof value !== 'object' || value === null) throw new Error('invalid Android pet file');
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || !SAFE_NATIVE_FILE_NAME.test(record.name)
    || typeof record.base64 !== 'string' || record.base64.length === 0
    || record.base64.length > MAX_NATIVE_FILE_BASE64_CHARACTERS
    || !CANONICAL_BASE64.test(record.base64)) {
    throw new Error('invalid Android pet file');
  }
  const suffix = record.name.toLowerCase().split('.').at(-1);
  const expectedMime: AndroidNativePetMime | undefined = suffix === 'zip'
    ? 'application/zip'
    : suffix === 'json' ? 'application/json' : suffix === 'webp' ? 'image/webp' : undefined;
  if (record.mimeType !== expectedMime || expectedMime === undefined) {
    throw new Error('invalid Android pet file');
  }
  return {
    name: record.name,
    mimeType: expectedMime,
    base64: record.base64,
  };
}

function parsePetFileSelection(value: unknown): AndroidPetFileSelection {
  if (typeof value !== 'object' || value === null) throw new Error('invalid Android file selection');
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.files)) throw new Error('invalid Android file selection');
  if (record.status === 'cancelled' && record.files.length === 0) {
    return { status: 'cancelled', files: [] };
  }
  if (record.status !== 'selected' || record.files.length < 1 || record.files.length > 2) {
    throw new Error('invalid Android file selection');
  }
  return { status: 'selected', files: record.files.map(parseNativePetFile) };
}

function requireSafePetId(id: string): void {
  if (!isSafeAndroidPetId(id)) throw new Error('unsafe Android pet id');
}

function parseAndroidCapabilities(value: unknown): AndroidCapabilities {
  if (typeof value !== 'object' || value === null) throw new Error('invalid Android capabilities');
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.apiLevel) || (record.apiLevel as number) < 1
    || (record.overlayPermission !== 'granted' && record.overlayPermission !== 'denied')
    || !['notRequired', 'notRequested', 'deniedCanAsk', 'blocked', 'granted']
      .includes(record.notificationPermission as string)
    || typeof record.serviceActive !== 'boolean'
    || typeof record.petVisible !== 'boolean') {
    throw new Error('invalid Android capabilities');
  }
  return record as unknown as AndroidCapabilities;
}

export function createAndroidHost(plugin: AndroidHostPlugin): AndroidControlHost {
  const callControl = async (method: keyof Pick<AndroidHostPlugin,
    'getCapabilities' | 'requestNotifications' | 'openNotificationSettings' | 'openOverlaySettings'
    | 'startService' | 'showPet' | 'hidePet' | 'quit'>): Promise<AndroidCapabilities> => {
    const handler = plugin[method];
    if (handler === undefined) throw new Error(`Android host method unavailable: ${method}`);
    return parseAndroidCapabilities(await handler.call(plugin));
  };

  return {
    async loadSnapshot(): Promise<AndroidHostSnapshot | null> {
      return parseAndroidHostSnapshot(await plugin.loadSnapshot());
    },

    async clearSettings(): Promise<void> { await plugin.clearSettings(); },
    async replaceHistory(historyJson): Promise<void> {
      historyJson.forEach(validateAndroidActivityEventJson);
      await plugin.replaceHistory({ historyJson: [...historyJson] });
    },
    async clearHistory(): Promise<void> { await plugin.clearHistory(); },
    async clearPets(): Promise<void> { await plugin.clearPets(); },

    async saveSettings(settingsJson: string): Promise<void> {
      validateAndroidSettingsJson(settingsJson);
      await plugin.saveSettings({ json: settingsJson });
    },

    async appendHistory(eventJson: string): Promise<void> {
      validateAndroidActivityEventJson(eventJson);
      await plugin.appendHistory({ json: eventJson });
    },

    async savePet(input: AndroidPetWrite): Promise<void> {
      requireSafePetId(input.id);
      validateAndroidPetMetadataJson(input.metadataJson, input.id);
      validateAndroidSpritesheetBase64(input.spritesheetBase64);
      await plugin.savePet(input);
    },

    async deletePet(id: string): Promise<void> {
      requireSafePetId(id);
      await plugin.deletePet({ id });
    },

    async selectPet(id: string): Promise<void> {
      requireSafePetId(id);
      await plugin.selectPet({ id });
    },

    getCapabilities: () => callControl('getCapabilities'),
    requestNotifications: () => callControl('requestNotifications'),
    openNotificationSettings: () => callControl('openNotificationSettings'),
    openOverlaySettings: () => callControl('openOverlaySettings'),
    startService: () => callControl('startService'),
    showPet: () => callControl('showPet'),
    hidePet: () => callControl('hidePet'),
    quit: () => callControl('quit'),

    async openPetdex(): Promise<void> {
      if (plugin.openPetdex === undefined) throw new Error('Android host method unavailable: openPetdex');
      await plugin.openPetdex();
    },

    async pickPetFiles(): Promise<AndroidPetFileSelection> {
      if (plugin.pickPetFiles === undefined) throw new Error('Android host method unavailable: pickPetFiles');
      return parsePetFileSelection(await plugin.pickPetFiles());
    },

    async consumePendingArchive(token: string): Promise<AndroidNativePetFile> {
      requireArchiveToken(token);
      if (plugin.consumePendingArchive === undefined) {
        throw new Error('Android host method unavailable: consumePendingArchive');
      }
      const file = parseNativePetFile(await plugin.consumePendingArchive({ token }));
      if (file.mimeType !== 'application/zip') throw new Error('invalid Android pending archive');
      return file;
    },

    async persistValidatedPet(input: AndroidPetWrite): Promise<void> {
      requireSafePetId(input.id);
      validateAndroidPetMetadataJson(input.metadataJson, input.id);
      validateAndroidSpritesheetBase64(input.spritesheetBase64);
      if (plugin.persistValidatedPet === undefined) {
        throw new Error('Android host method unavailable: persistValidatedPet');
      }
      await plugin.persistValidatedPet(input);
    },

    subscribe(listener): () => void {
      let disposed = false;
      let remove: (() => Promise<void>) | undefined;
      void plugin.addListener('stateChanged', (event) => {
        if (disposed || typeof event !== 'object' || event === null || !('snapshot' in event)) return;
        try {
          const snapshot = parseAndroidHostSnapshot(event.snapshot);
          if (snapshot !== null) listener({ type: 'stateChanged', snapshot });
        } catch {
          // Native storage is untrusted input; malformed change events are discarded.
        }
      }).then((handle) => {
        remove = handle.remove;
        if (disposed) void remove();
      });
      return () => {
        disposed = true;
        if (remove !== undefined) void remove();
      };
    },

    subscribeCapabilities(listener): () => void {
      let disposed = false;
      let remove: (() => Promise<void>) | undefined;
      void plugin.addListener('capabilitiesChanged', (event) => {
        if (disposed || typeof event !== 'object' || event === null || !('capabilities' in event)) return;
        try {
          listener({
            type: 'capabilitiesChanged',
            capabilities: parseAndroidCapabilities(event.capabilities),
          });
        } catch {
          // Native permission state is untrusted input; malformed events are discarded.
        }
      }).then((handle) => {
        remove = handle.remove;
        if (disposed) void remove();
      });
      return () => {
        disposed = true;
        if (remove !== undefined) void remove();
      };
    },

    subscribePetArchives(listener): () => void {
      let disposed = false;
      let remove: (() => Promise<void>) | undefined;
      void plugin.addListener('petArchiveReady', (event) => {
        if (disposed || typeof event !== 'object' || event === null || !('token' in event)
          || typeof event.token !== 'string') return;
        try {
          requireArchiveToken(event.token);
          listener({ type: 'pet-archive-ready', token: event.token });
        } catch {
          // Native handoff tokens are untrusted input; unsafe events are discarded.
        }
      }).then((handle) => {
        remove = handle.remove;
        if (disposed) void remove();
      });
      return () => {
        disposed = true;
        if (remove !== undefined) void remove();
      };
    },
  };
}

export function getAndroidHost(): AndroidControlHost {
  return createAndroidHost(registerPlugin<AndroidHostPlugin>('AndroidHost'));
}
