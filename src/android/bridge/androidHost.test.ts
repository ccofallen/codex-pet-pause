import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import { createAndroidHost, type AndroidHostPlugin } from './androidHost';

const rawSnapshot = {
  schemaVersion: 1,
  settingsJson: JSON.stringify(createDefaultSettings(1, 'en')),
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

  test('strictly parses capabilities and forwards every service command', async () => {
    const calls: string[] = [];
    const capabilities = {
      apiLevel: 35,
      overlayPermission: 'granted',
      notificationPermission: 'deniedCanAsk',
      serviceActive: true,
      petVisible: false,
    };
    const plugin = {
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
      getCapabilities: async () => capabilities,
      requestNotifications: async () => { calls.push('notifications'); return capabilities; },
      openNotificationSettings: async () => { calls.push('notificationSettings'); return capabilities; },
      openOverlaySettings: async () => { calls.push('overlaySettings'); return capabilities; },
      startService: async () => { calls.push('start'); return capabilities; },
      showPet: async () => { calls.push('show'); return capabilities; },
      hidePet: async () => { calls.push('hide'); return capabilities; },
      quit: async () => { calls.push('quit'); return capabilities; },
      addListener: async () => ({ remove: async () => undefined }),
    };
    const host = createAndroidHost(plugin);

    await expect(host.getCapabilities()).resolves.toEqual(capabilities);
    await host.requestNotifications();
    await host.openNotificationSettings();
    await host.openOverlaySettings();
    await host.startService();
    await host.showPet();
    await host.hidePet();
    await host.quit();

    expect(calls).toEqual([
      'notifications',
      'notificationSettings',
      'overlaySettings',
      'start',
      'show',
      'hide',
      'quit',
    ]);
  });

  test('forwards strict native capability refresh events', async () => {
    let nativeListener: ((value: unknown) => void) | undefined;
    const capabilities = {
      apiLevel: 28,
      overlayPermission: 'denied',
      notificationPermission: 'notRequired',
      serviceActive: false,
      petVisible: false,
    };
    const plugin = {
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
      getCapabilities: async () => capabilities,
      requestNotifications: async () => capabilities,
      openOverlaySettings: async () => capabilities,
      startService: async () => capabilities,
      showPet: async () => capabilities,
      hidePet: async () => capabilities,
      quit: async () => capabilities,
      addListener: async (eventName: string, listener: (value: unknown) => void) => {
        if (eventName === 'capabilitiesChanged') nativeListener = listener;
        return { remove: async () => undefined };
      },
    };
    const received: unknown[] = [];
    const unsubscribe = createAndroidHost(plugin).subscribeCapabilities((event) => received.push(event));

    nativeListener?.({ capabilities });
    await Promise.resolve();
    unsubscribe();

    expect(received).toEqual([{ type: 'capabilitiesChanged', capabilities }]);
  });

  test('strictly parses picker files and one-shot pending Petdex archives', async () => {
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
      pickPetFiles: async () => ({
        status: 'selected',
        files: [{ name: 'pet.json', mimeType: 'application/json', base64: 'e30=' }],
      }),
      consumePendingArchive: async ({ token }) => ({
        name: `${token}.zip`, mimeType: 'application/zip', base64: 'UEsDBA==',
      }),
      addListener: async () => ({ remove: async () => undefined }),
    };
    const host = createAndroidHost(plugin);

    await expect(host.pickPetFiles()).resolves.toEqual({
      status: 'selected',
      files: [{ name: 'pet.json', mimeType: 'application/json', base64: 'e30=' }],
    });
    await expect(host.consumePendingArchive('download-1')).resolves.toEqual({
      name: 'download-1.zip', mimeType: 'application/zip', base64: 'UEsDBA==',
    });
    await expect(host.consumePendingArchive('../escape')).rejects.toThrow(
      'invalid Android archive token',
    );
  });

  test('forwards only safe retained Petdex archive events', async () => {
    let nativeListener: ((value: unknown) => void) | undefined;
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
      addListener: async (eventName, listener) => {
        if (eventName === 'petArchiveReady') nativeListener = listener;
        return { remove: async () => undefined };
      },
    };
    const received: unknown[] = [];
    const unsubscribe = createAndroidHost(plugin)
      .subscribePetArchives((event) => received.push(event));

    nativeListener?.({ token: 'download-1' });
    nativeListener?.({ token: '../escape' });
    await Promise.resolve();
    unsubscribe();

    expect(received).toEqual([{ type: 'pet-archive-ready', token: 'download-1' }]);
  });

  test('persists dotted IDs accepted by the shared pet import contract', async () => {
    const persisted: unknown[] = [];
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
      persistValidatedPet: async (input) => { persisted.push(input); },
      addListener: async () => ({ remove: async () => undefined }),
    };
    const input = {
      id: 'moon.cat',
      metadataJson: JSON.stringify({
        id: 'moon.cat',
        displayName: 'Moon Cat',
        spriteVersion: 2,
        spritesheetFilename: 'spritesheet.webp',
        importedAt: 10,
        updatedAt: 20,
      }),
      spritesheetBase64: 'YQ==',
    };

    await createAndroidHost(plugin).persistValidatedPet(input);

    expect(persisted).toEqual([input]);
  });
});
