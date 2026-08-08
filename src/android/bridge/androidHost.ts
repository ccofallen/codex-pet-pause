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
  addListener(
    eventName: 'stateChanged',
    listener: (event: unknown) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function requireSafePetId(id: string): void {
  if (!isSafeAndroidPetId(id)) throw new Error('unsafe Android pet id');
}

export function createAndroidHost(plugin: AndroidHostPlugin): AndroidHost {
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
  };
}

export function getAndroidHost(): AndroidHost {
  return createAndroidHost(registerPlugin<AndroidHostPlugin>('AndroidHost'));
}
