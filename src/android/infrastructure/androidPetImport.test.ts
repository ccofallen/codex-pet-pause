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
  petImport.dispose();

  expect(received).toEqual([
    expect.objectContaining({ type: 'pet-archive-ready', token: 'download-1' }),
  ]);
  expect(remove).toHaveBeenCalledOnce();
});

test('queues an archive announcement before the pet page consumer subscribes', () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const remove = vi.fn();
  const navigationListener = vi.fn();
  const petImport = createAndroidPetImport(importHost({
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return remove;
    },
  }));
  const received: string[] = [];

  const disconnect = petImport.connect(navigationListener);
  nativeListener?.({ type: 'pet-archive-ready', token: 'download-before-mount' });
  const unsubscribe = petImport.subscribe(({ token }) => received.push(token));

  expect(navigationListener).toHaveBeenCalledWith({
    type: 'pet-archive-ready', token: 'download-before-mount',
  });
  expect(received).toEqual(['download-before-mount']);
  unsubscribe();
  expect(remove).not.toHaveBeenCalled();
  disconnect();
  expect(remove).toHaveBeenCalledOnce();
});

test('retries the active archive when app disposal is followed by persistence failure', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  let rejectPersist!: (reason: Error) => void;
  const completePendingArchive = vi.fn(async () => undefined);
  const petImport = createAndroidPetImport(importHost({
    completePendingArchive,
    persistValidatedPet: () => new Promise((_resolve, reject) => { rejectPersist = reject; }),
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  petImport.connect();
  let claim: { type: 'pet-archive-ready'; token: string; claimId?: number } | undefined;
  petImport.subscribe((event) => { claim = event; });
  nativeListener?.({ type: 'pet-archive-ready', token: 'dispose-failure' });
  const persistence = petImport.persistValidatedPet(MURK_TEST_PET, claim);

  await vi.waitFor(() => expect(rejectPersist).toBeTypeOf('function'));
  petImport.dispose();
  rejectPersist(new Error('native persistence failed'));
  await expect(persistence).rejects.toThrow('native persistence failed');

  expect(completePendingArchive).toHaveBeenCalledOnce();
  expect(completePendingArchive).toHaveBeenCalledWith('dispose-failure', 'retry');
});

test('redelivers a failed persistence claim to the consumer mounted while it was pending', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  let rejectPersist!: (reason: Error) => void;
  const petImport = createAndroidPetImport(importHost({
    persistValidatedPet: () => new Promise((_resolve, reject) => { rejectPersist = reject; }),
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  petImport.connect();
  const firstClaims: Array<{ token: string; claimId?: number }> = [];
  const unsubscribe = petImport.subscribe((event) => firstClaims.push(event));
  nativeListener?.({ type: 'pet-archive-ready', token: 'remount-failure' });
  const persistence = petImport.persistValidatedPet(MURK_TEST_PET, firstClaims[0]);
  await vi.waitFor(() => expect(rejectPersist).toBeTypeOf('function'));
  unsubscribe();
  const remountedClaims: Array<{ token: string; claimId?: number }> = [];
  petImport.subscribe((event) => remountedClaims.push(event));

  expect(remountedClaims).toEqual([]);
  rejectPersist(new Error('native persistence failed'));
  await expect(persistence).rejects.toThrow('native persistence failed');

  expect(remountedClaims).toHaveLength(1);
  expect(remountedClaims[0]).toMatchObject({ token: 'remount-failure' });
  expect(remountedClaims[0]!.claimId).not.toBe(firstClaims[0]!.claimId);
});

test('rejects completion from a released page claim after remount assigns a new lease', async () => {
  let nativeListener: ((event: { type: 'pet-archive-ready'; token: string }) => void) | undefined;
  const completePendingArchive = vi.fn(async () => undefined);
  const petImport = createAndroidPetImport(importHost({
    completePendingArchive,
    subscribePetArchives: (listener) => {
      nativeListener = listener;
      return () => undefined;
    },
  }));
  petImport.connect();
  let oldClaim: { token: string; claimId?: number } | undefined;
  const unsubscribe = petImport.subscribe((event) => { oldClaim = event; });
  nativeListener?.({ type: 'pet-archive-ready', token: 'leased-token' });
  unsubscribe();
  let newClaim: { token: string; claimId?: number } | undefined;
  petImport.subscribe((event) => { newClaim = event; });

  await expect(petImport.completePendingArchive('leased-token', 'retry', oldClaim))
    .rejects.toThrow('stale Android pending archive claim');
  expect(newClaim?.claimId).not.toBe(oldClaim?.claimId);
  expect(completePendingArchive).not.toHaveBeenCalled();
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
