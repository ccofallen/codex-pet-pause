import { describe, expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import { parseAndroidHostSnapshot } from '../domain/overlayProtocol';
import type { AndroidHost, AndroidHostSnapshot } from '../bridge/androidHost';
import {
  createAndroidHistoryRepository,
  createAndroidPetRepository,
  createAndroidSettingsRepository,
  createAndroidSnapshotReader,
} from './androidRepositories';

function host(): AndroidHost & { calls: string[] } {
  const calls: string[] = [];
  let snapshot: AndroidHostSnapshot | null = { schemaVersion: 1, settingsJson: JSON.stringify(createDefaultSettings(1, 'en')), historyJson: [JSON.stringify({ id: 'old', action: 'completed', occurredAt: 0 }), JSON.stringify({ id: 'new', action: 'completed', occurredAt: 100 })], pets: [], overlay: { xRatio: .5, yRatio: .5 } };
  return {
    calls,
    loadSnapshot: async () => snapshot,
    loadRuntimeSnapshot: async () => null,
    saveSettings: async () => {},
    clearSettings: async () => { snapshot = snapshot && { ...snapshot, settingsJson: null }; calls.push('clearSettings'); },
    appendHistory: async (eventJson) => {
      snapshot = snapshot && { ...snapshot, historyJson: [...snapshot.historyJson, eventJson] };
    },
    replaceHistory: async (historyJson) => { snapshot = snapshot && { ...snapshot, historyJson }; calls.push('replaceHistory'); },
    pruneHistory: async (before) => {
      snapshot = snapshot && {
        ...snapshot,
        historyJson: snapshot.historyJson.filter((value) => JSON.parse(value).occurredAt >= before),
      };
      calls.push('pruneHistory');
    },
    clearHistory: async () => { snapshot = snapshot && { ...snapshot, historyJson: [] }; calls.push('clearHistory'); },
    savePet: async () => {},
    deletePet: async () => {},
    clearPets: async () => { snapshot = snapshot && { ...snapshot, pets: [], overlay: { ...snapshot.overlay, activePet: undefined } }; calls.push('clearPets'); },
    selectPet: async () => {},
    subscribe: () => () => undefined,
  };
}

describe('Android persistent repositories', () => {
  test('represents an uninitialized native state as null', () => { expect(parseAndroidHostSnapshot(null)).toBeNull(); });
  test('rejects invalid settings, history, metadata, and base64 from native input', () => {
    const valid = { schemaVersion: 1, settingsJson: '{}', historyJson: [], pets: [], overlay: { xRatio: .5, yRatio: .5 } };
    expect(() => parseAndroidHostSnapshot(valid)).toThrow('invalid Android settings');
    expect(() => parseAndroidHostSnapshot({ ...valid, settingsJson: JSON.stringify(createDefaultSettings(1, 'en')), historyJson: ['{'] })).toThrow('invalid Android history');
    expect(() => parseAndroidHostSnapshot({ ...valid, settingsJson: JSON.stringify(createDefaultSettings(1, 'en')), pets: [{ id: 'p', metadataJson: '{}', assetPath: 'pets/p/0123456789abcdef0123456789abcdef/spritesheet.webp', spritesheetBase64: 'c3ByaXRl' }] })).toThrow('invalid Android pet metadata');
    expect(() => parseAndroidHostSnapshot({ ...valid, settingsJson: JSON.stringify(createDefaultSettings(1, 'en')), pets: [{ id: 'p', metadataJson: '{"id":"p","displayName":"P","spriteVersion":2,"spritesheetFilename":"p.webp","importedAt":1,"updatedAt":2}', assetPath: 'pets/p/0123456789abcdef0123456789abcdef/spritesheet.webp', spritesheetBase64: 'AB==' }] })).toThrow('invalid Android pet spritesheet');
  });
  test('implements settings clear, history prune/clear, and pets clear', async () => {
    const value = host(); const settings = createAndroidSettingsRepository(value); const history = createAndroidHistoryRepository(value); const pets = createAndroidPetRepository(value);
    await history.prune(90 * 24 * 60 * 60 * 1000 + 1); await history.clear(); await pets.clear(); await settings.clear();
    expect(value.calls).toEqual(['pruneHistory', 'clearHistory', 'clearPets', 'clearSettings']);
  });

  test('atomic prune preserves a native completion committed after the full snapshot was cached', async () => {
    const value = host();
    const snapshots = createAndroidSnapshotReader(value);
    await snapshots.load();
    const completion = JSON.stringify({ id: 'overlay-completion', action: 'completed', occurredAt: 200 });
    await value.appendHistory(completion);

    await createAndroidHistoryRepository(value, snapshots).prune(150 + 90 * 24 * 60 * 60 * 1000);

    await expect(value.loadSnapshot()).resolves.toMatchObject({ historyJson: [completion] });
    expect(value.calls).toEqual(['pruneHistory']);
  });
});
