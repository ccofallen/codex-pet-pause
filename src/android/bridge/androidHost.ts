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

export interface AndroidControlHost extends AndroidHost {
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
  addListener(
    eventName: 'stateChanged' | 'capabilitiesChanged',
    listener: (event: unknown) => void,
  ): Promise<{ remove: () => Promise<void> }>;
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
  };
}

export function getAndroidHost(): AndroidControlHost {
  return createAndroidHost(registerPlugin<AndroidHostPlugin>('AndroidHost'));
}
