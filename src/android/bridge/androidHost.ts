import { registerPlugin } from '@capacitor/core';
import {
  isSafeAndroidPetId,
  parseAndroidHostSnapshot,
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
  clearSettings?: () => Promise<void>;
  replaceHistory?: (historyJson: readonly string[]) => Promise<void>;
  clearHistory?: () => Promise<void>;
  clearPets?: () => Promise<void>;
  saveSettings(settingsJson: string): Promise<void>;
  appendHistory(eventJson: string): Promise<void>;
  savePet(input: AndroidPetWrite): Promise<void>;
  deletePet(id: string): Promise<void>;
  selectPet(id: string): Promise<void>;
  subscribe(listener: (event: AndroidHostEvent) => void): () => void;
}

export interface AndroidHostPlugin {
  loadSnapshot(): Promise<unknown>;
  clearSettings?: () => Promise<void>;
  replaceHistory?: (options: { historyJson: string[] }) => Promise<void>;
  clearHistory?: () => Promise<void>;
  clearPets?: () => Promise<void>;
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

function requireJsonObject(value: string, message: string): void {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(message);
  } catch {
    throw new Error(message);
  }
}

function requireSafePetId(id: string): void {
  if (!isSafeAndroidPetId(id)) throw new Error('unsafe Android pet id');
}

export function createAndroidHost(plugin: AndroidHostPlugin): AndroidHost {
  return {
    async loadSnapshot(): Promise<AndroidHostSnapshot | null> {
      return parseAndroidHostSnapshot(await plugin.loadSnapshot());
    },

    async clearSettings(): Promise<void> { await plugin.clearSettings!(); },
    async replaceHistory(historyJson): Promise<void> { await plugin.replaceHistory!({ historyJson: [...historyJson] }); },
    async clearHistory(): Promise<void> { await plugin.clearHistory!(); },
    async clearPets(): Promise<void> { await plugin.clearPets!(); },

    async saveSettings(settingsJson: string): Promise<void> {
      requireJsonObject(settingsJson, 'invalid Android settings JSON');
      await plugin.saveSettings({ json: settingsJson });
    },

    async appendHistory(eventJson: string): Promise<void> {
      requireJsonObject(eventJson, 'invalid Android history JSON');
      await plugin.appendHistory({ json: eventJson });
    },

    async savePet(input: AndroidPetWrite): Promise<void> {
      requireSafePetId(input.id);
      requireJsonObject(input.metadataJson, 'invalid Android pet metadata JSON');
      if (input.spritesheetBase64.length === 0) throw new Error('invalid Android pet spritesheet');
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
