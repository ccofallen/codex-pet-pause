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
});
