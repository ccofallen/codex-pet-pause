import { expect, test, vi } from 'vitest';
import { MURK_TEST_PET } from '../../test/petFixtures';
import type {
  AndroidNativePetFile,
  AndroidPetImportHost,
  AndroidPetWrite,
} from '../bridge/androidHost';
import { createAndroidPetImport } from './androidPetImport';

function nativeFile(
  name: string,
  mimeType: AndroidNativePetFile['mimeType'],
  base64: string,
): AndroidNativePetFile {
  return { name, mimeType, base64 };
}

function importHost(overrides: Partial<AndroidPetImportHost> = {}): AndroidPetImportHost {
  return {
    openPetdex: async () => undefined,
    pickPetFiles: async () => ({ status: 'cancelled', files: [] }),
    consumePendingArchive: async () => nativeFile('pet.zip', 'application/zip', 'UEsDBA=='),
    completePendingArchive: async () => undefined,
    persistValidatedPet: async () => undefined,
    subscribePetArchives: () => () => undefined,
    ...overrides,
  };
}

test('converts a native JSON and WebP selection into the original independent-file workflow', async () => {
  const host = importHost({
    pickPetFiles: async () => ({
      status: 'selected',
      files: [
        nativeFile('pet.json', 'application/json', 'e30='),
        nativeFile('spritesheet.webp', 'image/webp', 'UklGRg=='),
      ],
    }),
  });

  const files = await createAndroidPetImport(host).pickFiles();

  expect(files.map(({ name, type, size }) => ({ name, type, size }))).toEqual([
    { name: 'pet.json', type: 'application/json', size: 2 },
    { name: 'spritesheet.webp', type: 'image/webp', size: 4 },
  ]);
});

test('treats system-picker cancellation as a no-op', async () => {
  const files = await createAndroidPetImport(importHost()).pickFiles();
  expect(files).toEqual([]);
});

test('consumes a pending Petdex archive exactly through the native handoff', async () => {
  const consumePendingArchive = vi.fn(async () => (
    nativeFile('momo.zip', 'application/zip', 'UEsDBA==')
  ));
  const petImport = createAndroidPetImport(importHost({ consumePendingArchive }));

  const archive = await petImport.consumePendingArchive('download-1');

  expect(consumePendingArchive).toHaveBeenCalledWith('download-1');
  expect({ name: archive.name, type: archive.type, size: archive.size }).toEqual({
    name: 'momo.zip', type: 'application/zip', size: 4,
  });
});

test('persists validated metadata and atlas bytes without serializing the Blob object', async () => {
  const persistValidatedPet = vi.fn(async (_input: AndroidPetWrite) => undefined);
  const petImport = createAndroidPetImport(importHost({ persistValidatedPet }));

  await petImport.persistValidatedPet(MURK_TEST_PET);

  expect(persistValidatedPet).toHaveBeenCalledOnce();
  const input = persistValidatedPet.mock.calls[0]![0];
  expect(input.id).toBe('murk');
  expect(input.spritesheetBase64).toBe('dGVzdC13ZWJw');
  const metadata = JSON.parse(input.metadataJson) as Record<string, unknown>;
  expect(metadata).toMatchObject({
    id: 'murk',
    displayName: 'Murk',
    description: 'Moon ghost',
    spriteVersion: 2,
    spritesheetFilename: 'spritesheet.webp',
    importedAt: 100,
    updatedAt: 100,
    frameMetadata: {
      animationColumns: { idle: [0, 1, 2, 3, 4, 5] },
      visibleLookDirections: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    },
  });
  expect(metadata).not.toHaveProperty('spritesheet');
});

test('forwards immediate native archive-ready events and unsubscribes cleanly', () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const remove = vi.fn();
  const petImport = createAndroidPetImport(importHost({
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return remove;
    },
  }));
  const received: unknown[] = [];

  const unsubscribe = petImport.subscribe((event) => received.push(event));
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-1' });
  unsubscribe();

  expect(received).toEqual([{ type: 'pet-archive-ready', token: 'download-1' }]);
  expect(remove).toHaveBeenCalledOnce();
});

test('serializes duplicate native announcements until the active claim is explicitly finished', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const completePendingArchive = vi.fn(async () => undefined);
  const petImport = createAndroidPetImport(importHost({
    completePendingArchive,
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  const received: string[] = [];
  petImport.subscribe(({ token }) => received.push(token));

  nativeListener?.({ type: 'pet-archive-ready', token: 'download-1' });
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-1' });
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-2' });
  expect(received).toEqual(['download-1']);

  await petImport.completePendingArchive('download-1', 'cancelled');
  expect(completePendingArchive).toHaveBeenCalledWith('download-1', 'cancelled');
  expect(received).toEqual(['download-1', 'download-2']);
});

test('retry keeps later native announcements blocked behind the recoverable first archive', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const petImport = createAndroidPetImport(importHost({
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  const received: string[] = [];
  petImport.subscribe(({ token }) => received.push(token));
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-1' });
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-2' });

  await petImport.completePendingArchive('download-1', 'retry');

  expect(received).toEqual(['download-1']);
});

test('retries a transient native acknowledgement and advances the queued token transparently', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const completePendingArchive = vi.fn()
    .mockRejectedValueOnce(new Error('temporary tombstone failure'))
    .mockResolvedValueOnce(undefined);
  const petImport = createAndroidPetImport(importHost({
    completePendingArchive,
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  const received: string[] = [];
  petImport.subscribe(({ token }) => received.push(token));
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-1' });
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-2' });

  await petImport.completePendingArchive('download-1', 'imported');

  expect(completePendingArchive).toHaveBeenCalledTimes(2);
  expect(received).toEqual(['download-1', 'download-2']);
});

test('applies the typed committed native snapshot without waiting for a state event', async () => {
  const settings = {
    schemaVersion: 5,
    locale: 'en',
    onboardingComplete: true,
    theme: 'system',
    petSize: 'medium',
    soundEnabled: false,
    animationsEnabled: true,
    affinity: 0,
    quietHours: { enabled: false, startMinutes: 1320, endMinutes: 420 },
    runtime: {},
    cat: { name: 'Momo' },
    activePetId: 'murk',
    petPosition: { xRatio: 0.82, yRatio: 0.72 },
    reminders: [
      { id: 'lookAway', kind: 'preset', type: 'lookAway', enabled: false, intervalMinutes: 20, nextDueAt: 1, status: 'disabled' },
      { id: 'drinkWater', kind: 'preset', type: 'drinkWater', enabled: false, intervalMinutes: 45, nextDueAt: 1, status: 'disabled' },
      { id: 'standUp', kind: 'preset', type: 'standUp', enabled: false, intervalMinutes: 60, nextDueAt: 1, status: 'disabled' },
      { id: 'takeBreak', kind: 'preset', type: 'takeBreak', enabled: false, intervalMinutes: 90, nextDueAt: 1, status: 'disabled' },
    ],
  } as const;
  const { spritesheet: _spritesheet, ...metadata } = MURK_TEST_PET;
  const snapshot = {
    schemaVersion: 1 as const,
    settingsJson: JSON.stringify(settings),
    historyJson: [],
    pets: [{
      id: 'murk',
      metadataJson: JSON.stringify(metadata),
      assetPath: 'pets/murk/0123456789abcdef0123456789abcdef/spritesheet.webp',
      spritesheetBase64: 'dGVzdC13ZWJw',
    }],
    overlay: { xRatio: 0.82, yRatio: 0.72 },
  };
  const applyCommittedSnapshot = vi.fn();
  const petImport = createAndroidPetImport(importHost({
    persistValidatedPet: async () => ({ snapshot, refreshWarning: true }),
  }), applyCommittedSnapshot);

  const result = await petImport.persistValidatedPet(MURK_TEST_PET);

  expect(result).toEqual({ snapshot, refreshWarning: true });
  expect(applyCommittedSnapshot).toHaveBeenCalledWith(snapshot);
});
