import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHost, AndroidHostSnapshot, AndroidPetWrite } from '../bridge/androidHost';
import {
  createAndroidHistoryRepository,
  createAndroidPetRepository,
  createAndroidSettingsRepository,
  readAndroidBlobBytes,
} from './androidRepositories';

function createHost(): AndroidHost {
  let snapshot: AndroidHostSnapshot = {
    schemaVersion: 1,
    settingsJson: JSON.stringify(createDefaultSettings(0, 'en')),
    historyJson: [],
    pets: [],
    overlay: { xRatio: 0.82, yRatio: 0.72 },
  };
  return {
    loadSnapshot: async () => snapshot,
    saveSettings: async (settingsJson) => { snapshot = { ...snapshot, settingsJson }; },
    appendHistory: async (eventJson) => { snapshot = { ...snapshot, historyJson: [...snapshot.historyJson, eventJson] }; },
    savePet: async (input: AndroidPetWrite) => {
      snapshot = {
        ...snapshot,
        pets: [...snapshot.pets.filter((pet) => pet.id !== input.id), {
          id: input.id,
          metadataJson: input.metadataJson,
          assetPath: `pets/${input.id}/spritesheet.webp`,
          spritesheetBase64: input.spritesheetBase64,
        }],
      };
    },
    deletePet: async (id) => { snapshot = { ...snapshot, pets: snapshot.pets.filter((pet) => pet.id !== id) }; },
    selectPet: async (id) => {
      snapshot = { ...snapshot, overlay: { ...snapshot.overlay, activePet: snapshot.pets.find((pet) => pet.id === id) } };
    },
    subscribe: () => () => undefined,
  };
}

describe('Android repositories', () => {
  test('round trips settings, history, and a pet through the Android host', async () => {
    const host = createHost();
    const settings = createAndroidSettingsRepository(host);
    const history = createAndroidHistoryRepository(host);
    const pets = createAndroidPetRepository(host);
    const nextSettings = { ...createDefaultSettings(0, 'en'), theme: 'dark' as const };

    await settings.save(nextSettings);
    await history.append({ id: 'event-1', action: 'completed', occurredAt: 100 });
    await pets.put({
      id: 'momo',
      displayName: 'Momo',
      spriteVersion: 2,
      spritesheetFilename: 'momo.webp',
      spritesheet: new Blob(['sprite'], { type: 'image/webp' }),
      importedAt: 10,
      updatedAt: 20,
    });

    await expect(settings.load()).resolves.toEqual(nextSettings);
    await expect(history.listSince(50)).resolves.toEqual([{ id: 'event-1', action: 'completed', occurredAt: 100 }]);
    const [pet] = await pets.list();
    expect(pet).toMatchObject({ id: 'momo', displayName: 'Momo', spriteVersion: 2 });
    expect(new TextDecoder().decode(await readAndroidBlobBytes(pet!.spritesheet))).toBe("sprite");
  });

  test('rejects a malformed history record from native storage', async () => {
    const host = createHost();
    host.appendHistory('{"id":"missing-action"}');

    await expect(createAndroidHistoryRepository(host).listSince(0)).rejects.toThrow('invalid Android history event');
  });
});
