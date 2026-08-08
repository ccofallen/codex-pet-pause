import { describe, expect, test } from 'vitest';
import { createAndroidHost, type AndroidHostPlugin } from './androidHost';

const rawSnapshot = {
  schemaVersion: 1,
  settingsJson: '{"schemaVersion":5}',
  historyJson: [],
  pets: [],
  overlay: { xRatio: 0.2, yRatio: 0.3 },
};

describe('createAndroidHost', () => {
  test('loads a strictly parsed snapshot from the Capacitor plugin', async () => {
    const host = createAndroidHost({
      loadSnapshot: async () => rawSnapshot,
      clearSettings: async () => undefined,
      replaceHistory: async () => undefined,
      clearHistory: async () => undefined,
      clearPets: async () => undefined,
      saveSettings: async () => undefined,
      appendHistory: async () => undefined,
      savePet: async () => undefined,
      deletePet: async () => undefined,
      selectPet: async () => undefined,
      addListener: async () => ({ remove: async () => undefined }),
    });

    await expect(host.loadSnapshot()).resolves.toEqual(rawSnapshot);
  });

  test('forwards validated state change events and removes the native listener', async () => {
    let nativeListener: ((value: unknown) => void) | undefined;
    let removed = false;
    const plugin: AndroidHostPlugin = {
      loadSnapshot: async () => rawSnapshot,
      clearSettings: async () => undefined,
      replaceHistory: async () => undefined,
      clearHistory: async () => undefined,
      clearPets: async () => undefined,
      saveSettings: async () => undefined,
      appendHistory: async () => undefined,
      savePet: async () => undefined,
      deletePet: async () => undefined,
      selectPet: async () => undefined,
      addListener: async (_event, listener) => {
        nativeListener = listener;
        return { remove: async () => { removed = true; } };
      },
    };
    const received: unknown[] = [];
    const unsubscribe = createAndroidHost(plugin).subscribe((event) => received.push(event));

    nativeListener?.({ snapshot: rawSnapshot });
    await Promise.resolve();
    unsubscribe();
    await Promise.resolve();

    expect(received).toEqual([{ type: 'stateChanged', snapshot: rawSnapshot }]);
    expect(removed).toBe(true);
  });

  test('forwards every required maintenance operation to the native plugin', async () => {
    const calls: string[] = [];
    const plugin: AndroidHostPlugin = {
      loadSnapshot: async () => null,
      clearSettings: async () => { calls.push('clearSettings'); },
      replaceHistory: async ({ historyJson }) => { calls.push(`replaceHistory:${historyJson.length}`); },
      clearHistory: async () => { calls.push('clearHistory'); },
      clearPets: async () => { calls.push('clearPets'); },
      saveSettings: async () => undefined,
      appendHistory: async () => undefined,
      savePet: async () => undefined,
      deletePet: async () => undefined,
      selectPet: async () => undefined,
      addListener: async () => ({ remove: async () => undefined }),
    };
    const host = createAndroidHost(plugin);

    await host.clearSettings();
    await host.replaceHistory(['{"id":"event-1","action":"completed","occurredAt":1}']);
    await host.clearHistory();
    await host.clearPets();

    expect(calls).toEqual(['clearSettings', 'replaceHistory:1', 'clearHistory', 'clearPets']);
  });

  test('rejects type-confused JSON and non-canonical base64 before native calls', async () => {
    let nativeCalls = 0;
    const plugin: AndroidHostPlugin = {
      loadSnapshot: async () => null,
      clearSettings: async () => undefined,
      replaceHistory: async () => undefined,
      clearHistory: async () => undefined,
      clearPets: async () => undefined,
      saveSettings: async () => { nativeCalls += 1; },
      appendHistory: async () => { nativeCalls += 1; },
      savePet: async () => { nativeCalls += 1; },
      deletePet: async () => undefined,
      selectPet: async () => undefined,
      addListener: async () => ({ remove: async () => undefined }),
    };
    const host = createAndroidHost(plugin);

    await expect(host.saveSettings('{"schemaVersion":4}')).rejects.toThrow('invalid Android settings JSON');
    await expect(host.appendHistory('{"schemaVersion":5}')).rejects.toThrow('invalid Android history JSON');
    await expect(host.savePet({
      id: 'momo',
      metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
      spritesheetBase64: 'AB==',
    })).rejects.toThrow('invalid Android pet spritesheet');
    expect(nativeCalls).toBe(0);
  });
});
