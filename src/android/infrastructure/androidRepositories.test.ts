import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHost, AndroidHostSnapshot, AndroidPetWrite } from '../bridge/androidHost';
import {
  createAndroidHistoryRepository,
  createAndroidPetRepository,
  createAndroidSettingsRepository,
  createAndroidSnapshotReader,
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
    loadRuntimeSnapshot: async () => null,
    loadPetCatalog: async () => ({
      revision: snapshot.runtimeRevision ?? 0,
      activePetId: snapshot.settingsJson === null
        ? 'builtin-cat'
        : JSON.parse(snapshot.settingsJson).activePetId as string,
      pets: snapshot.pets.map((pet) => ({
        id: pet.id,
        metadataJson: pet.metadataJson,
        assetRevision: pet.assetPath.split('/')[2]!,
        thumbnailBase64: pet.spritesheetBase64 ?? null,
      })),
    }),
    clearSettings: async () => undefined,
    replaceHistory: async (historyJson) => { snapshot = { ...snapshot, historyJson }; },
    clearHistory: async () => { snapshot = { ...snapshot, historyJson: [] }; },
    clearPets: async () => { snapshot = { ...snapshot, pets: [], overlay: { ...snapshot.overlay, activePet: undefined } }; },
    saveSettings: async (settingsJson) => { snapshot = { ...snapshot, settingsJson }; },
    appendHistory: async (eventJson) => { snapshot = { ...snapshot, historyJson: [...snapshot.historyJson, eventJson] }; },
    pruneHistory: async () => undefined,
    savePet: async (input: AndroidPetWrite) => {
      snapshot = {
        ...snapshot,
        pets: [...snapshot.pets.filter((pet) => pet.id !== input.id), {
          id: input.id,
          metadataJson: input.metadataJson,
          assetPath: `pets/${input.id}/0123456789abcdef0123456789abcdef/spritesheet.webp`,
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
  test('lists production pets from compact thumbnails without loading or decoding the full snapshot', async () => {
    const loadSnapshot = vi.fn(async () => { throw new Error('full snapshot must not load'); });
    const host: AndroidHost = {
      ...createHost(),
      loadSnapshot,
      loadPetCatalog: async () => ({
        revision: 7,
        activePetId: 'momo',
        pets: [{
          id: 'momo',
          metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
          assetRevision: '0123456789abcdef0123456789abcdef',
          thumbnailBase64: 'dGlueQ==',
        }],
      }),
    };

    const [pet] = await createAndroidPetRepository(host).list();

    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(pet).toMatchObject({ id: 'momo', displayName: 'Momo', atlasRevision: '0123456789abcdef0123456789abcdef' });
    expect(new TextDecoder().decode(await readAndroidBlobBytes(pet!.thumbnail!))).toBe('tiny');
    expect(pet).not.toHaveProperty('spritesheet');
  });

  test('keeps a failed compact preview as metadata-only and refuses to persist it as an atlas', async () => {
    const savePet = vi.fn(async () => undefined);
    const host: AndroidHost = {
      ...createHost(),
      savePet,
      loadPetCatalog: async () => ({
        revision: 8,
        activePetId: 'momo',
        pets: [{
          id: 'momo',
          metadataJson: '{"id":"momo","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}',
          assetRevision: '0123456789abcdef0123456789abcdef',
          thumbnailBase64: null,
        }],
      }),
    };
    const repository = createAndroidPetRepository(host);
    const [pet] = await repository.list();

    expect(pet).not.toHaveProperty('spritesheet');
    expect(pet).not.toHaveProperty('thumbnail');
    await expect(repository.put(pet as never)).rejects.toThrow('full Android pet spritesheet required');
    expect(savePet).not.toHaveBeenCalled();
  });

  test('shares one large native snapshot until a committed write invalidates it', async () => {
    const host = createHost();
    const loadSnapshot = vi.spyOn(host, 'loadSnapshot');
    const snapshots = createAndroidSnapshotReader(host);
    const settings = createAndroidSettingsRepository(host, undefined, snapshots);
    const pets = createAndroidPetRepository(host, snapshots);
    const history = createAndroidHistoryRepository(host, snapshots);

    await settings.load();
    await Promise.all([pets.list(), history.listSince(0)]);

    expect(loadSnapshot).toHaveBeenCalledOnce();

    await settings.save({ ...createDefaultSettings(0, 'en'), theme: 'dark' });
    await settings.load();

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  test('first settings load persists Android defaults before the overlay can start', async () => {
    const persisted = createHost();
    let cleanInstall = true;
    const host: AndroidHost = {
      ...persisted,
      loadSnapshot: async () => cleanInstall ? null : persisted.loadSnapshot(),
      saveSettings: async (settingsJson) => {
        cleanInstall = false;
        await persisted.saveSettings(settingsJson);
      },
    };
    const defaults = createDefaultSettings(123, 'en');
    const repository = createAndroidSettingsRepository(host, () => defaults);

    await expect(repository.load()).resolves.toEqual(defaults);
    await expect(host.loadSnapshot()).resolves.toMatchObject({
      settingsJson: JSON.stringify(defaults),
    });
  });

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
    expect(new TextDecoder().decode(await readAndroidBlobBytes(pet!.thumbnail!))).toBe("sprite");
    expect(pet).not.toHaveProperty('spritesheet');
  });

  test('rejects a malformed history record from native storage', async () => {
    const host = createHost();
    host.appendHistory('{"id":"missing-action"}');

    await expect(createAndroidHistoryRepository(host).listSince(0)).rejects.toThrow('invalid Android history event');
  });

  test('returns null after native settings are cleared without losing the snapshot', async () => {
    const host = createHost();
    host.clearSettings = async () => {
      const current = await host.loadSnapshot();
      if (current !== null) Object.assign(current, { settingsJson: null });
    };
    const settings = createAndroidSettingsRepository(host);

    await settings.clear();

    await expect(settings.load()).resolves.toBeNull();
  });
});
