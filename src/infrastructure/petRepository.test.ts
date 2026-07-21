import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { MURK_TEST_PET } from '../test/petFixtures';
import type { PetFrameMetadata } from '../features/pets/domain/types';
import {
  atlasContentFingerprint, createIndexedDbPetRepository, PET_DB, PET_STORE,
} from './petRepository';

type EventHandler = ((event: Event) => void) | null;

function withPet(overrides: Partial<typeof MURK_TEST_PET>) {
  return { ...MURK_TEST_PET, ...overrides };
}

const frameMetadata: PetFrameMetadata = {
  animationColumns: {
    idle: [0],
    'running-right': [1],
    'running-left': [2],
    waving: [3],
    jumping: [4],
    failed: [5],
    waiting: [0],
    running: [1],
    review: [2],
  },
  visibleLookDirections: [0, 2, 4],
};

const replacementFrameMetadata: PetFrameMetadata = {
  animationColumns: {
    idle: [7],
    'running-right': [6],
    'running-left': [5],
    waving: [4],
    jumping: [3],
    failed: [2],
    waiting: [7],
    running: [6],
    review: [5],
  },
  visibleLookDirections: [1, 3, 5],
};

function legacyPet() {
  const { frameMetadata: _metadata, ...pet } = MURK_TEST_PET;
  return {
    ...pet,
    spritesheet: new NodeBlob(['test-webp'], { type: 'image/webp' }) as Blob,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function seedStoredPet(
  factory: IDBFactory,
  databaseName: string,
  pet: ReturnType<typeof legacyPet>,
): Promise<void> {
  const request = factory.open(databaseName, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(PET_STORE)) {
      request.result.createObjectStore(PET_STORE, { keyPath: 'id' });
    }
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction(PET_STORE, 'readwrite');
  transaction.objectStore(PET_STORE).put(pet);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

function createOpenFailureFactory(failure: Error): IDBFactory {
  return {
    open: () => {
      const request = {
        error: failure,
        onblocked: null as EventHandler,
        onerror: null as EventHandler,
        onsuccess: null as EventHandler,
        onupgradeneeded: null as EventHandler,
      };
      queueMicrotask(() => request.onerror?.(new Event('error')));
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

function createTransactionAbortFactory(failure: Error): IDBFactory {
  const database = {
    transaction: () => {
      const transaction = {
        error: failure,
        onabort: null as EventHandler,
        oncomplete: null as EventHandler,
        onerror: null as EventHandler,
        objectStore: () => ({
          getAll: () => {
            const request = {
              error: null,
              onerror: null as EventHandler,
              onsuccess: null as EventHandler,
              result: [MURK_TEST_PET],
            };
            queueMicrotask(() => {
              request.onsuccess?.(new Event('success'));
              transaction.onabort?.(new Event('abort'));
            });
            return request;
          },
        }),
      };
      return transaction as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;

  return {
    open: () => {
      const request = {
        error: null,
        result: database,
        onblocked: null as EventHandler,
        onerror: null as EventHandler,
        onsuccess: null as EventHandler,
        onupgradeneeded: null as EventHandler,
      };
      queueMicrotask(() => request.onsuccess?.(new Event('success')));
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe('IndexedDB pet repository', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
  });

  test('uses the dedicated pet database and store names', () => {
    expect(PET_DB).toBe('codex-pet-pause-pets');
    expect(PET_STORE).toBe('pets');
  });

  test('uses a deterministic full-byte fallback when Web Crypto is unavailable', async () => {
    const original = new TextEncoder().encode('same-size-a').buffer;
    const replacement = new TextEncoder().encode('same-size-b').buffer;

    const first = await atlasContentFingerprint(original, null);

    await expect(atlasContentFingerprint(original.slice(0), null)).resolves.toBe(first);
    await expect(atlasContentFingerprint(replacement, null)).resolves.not.toBe(first);
  });

  test('falls back when Web Crypto digest rejects', async () => {
    const bytes = new TextEncoder().encode('atlas').buffer;
    const rejectDigest = vi.fn(async () => { throw new Error('digest unavailable'); });

    await expect(atlasContentFingerprint(bytes, rejectDigest))
      .resolves.toBe(await atlasContentFingerprint(bytes, null));
    expect(rejectDigest).toHaveBeenCalledOnce();
  });

  test('round-trips a WebP spritesheet Blob', async () => {
    const repository = createIndexedDbPetRepository(factory);
    const pet = withPet({
      spritesheet: new NodeBlob(['test-webp'], { type: 'image/webp' }) as Blob,
    });

    await repository.put(pet);

    const [stored] = await repository.list();
    expect(stored).toEqual(expect.objectContaining({
      id: 'murk',
      displayName: 'Murk',
      spritesheetFilename: 'spritesheet.webp',
    }));
    expect(stored!.spritesheet).toBeInstanceOf(NodeBlob);
    expect(stored!.spritesheet.type).toBe('image/webp');
    await expect(stored!.spritesheet.text()).resolves.toBe('test-webp');
  });

  test('put atomically replaces an existing pet with the same id', async () => {
    const repository = createIndexedDbPetRepository(factory);
    await repository.put(MURK_TEST_PET);

    await repository.put(withPet({ displayName: 'Murk II', updatedAt: 200 }));

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: 'murk', displayName: 'Murk II', updatedAt: 200 }),
    ]);
  });

  test('preserves invocation order when delete follows a put with a pending revision', async () => {
    const pendingRevision = deferred<string>();
    const revisioner = vi.fn(() => pendingRevision.promise);
    const databaseName = 'put-delete-order';
    const repository = createIndexedDbPetRepository(
      factory, databaseName, async () => frameMetadata, revisioner,
    );
    await seedStoredPet(factory, databaseName, legacyPet());

    const putting = repository.put({ ...legacyPet(), displayName: 'Replacement' });
    await vi.waitFor(() => expect(revisioner).toHaveBeenCalledOnce());
    const deleting = repository.delete(MURK_TEST_PET.id);
    pendingRevision.resolve('replacement-revision');
    await Promise.all([putting, deleting]);

    await expect(repository.list()).resolves.toEqual([]);
  });

  test('list sorts by displayName and returns clones', async () => {
    const repository = createIndexedDbPetRepository(factory);
    await repository.put(withPet({ id: 'z', displayName: 'Zebra' }));
    await repository.put(withPet({ id: 'a', displayName: 'Alpaca' }));

    const first = await repository.list();
    first[0]!.displayName = 'Changed outside the repository';

    const second = await repository.list();
    expect(second.map(({ displayName }) => displayName)).toEqual(['Alpaca', 'Zebra']);
  });

  test('returns legacy records before analysis finishes, then persists metadata in the background', async () => {
    const analysis = deferred<PetFrameMetadata>();
    const analyzer = vi.fn((_file: File) => analysis.promise);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());

    const first = await repository.list();
    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());
    expect(analyzer.mock.calls[0]?.[0]?.name).toBe(MURK_TEST_PET.spritesheetFilename);
    expect(first[0]).not.toHaveProperty('frameMetadata');

    analysis.resolve(frameMetadata);
    await vi.waitFor(async () => {
      const [persisted] = await repository.list();
      expect(persisted?.frameMetadata).toEqual(frameMetadata);
    });

    const reopenedAnalyzer = vi.fn(async () => replacementFrameMetadata);
    const reopened = createIndexedDbPetRepository(factory, undefined, reopenedAnalyzer);
    await expect(reopened.list()).resolves.toEqual([
      expect.objectContaining({ frameMetadata, atlasRevision: expect.any(String) }),
    ]);
    expect(reopenedAnalyzer).not.toHaveBeenCalled();
  });

  test('shares one in-flight background analysis between concurrent lists for the same revision', async () => {
    const analysis = deferred<PetFrameMetadata>();
    const analyzer = vi.fn((_file: File) => analysis.promise);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());

    const first = await repository.list();
    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());
    const second = await repository.list();
    await nextTask();
    await nextTask();

    expect(analyzer).toHaveBeenCalledOnce();
    expect(first[0]).not.toHaveProperty('frameMetadata');
    expect(second[0]).not.toHaveProperty('frameMetadata');
    analysis.resolve(frameMetadata);
    await vi.waitFor(async () => {
      expect((await repository.list())[0]?.frameMetadata).toEqual(frameMetadata);
    });
  });

  test('returns independent clones to concurrent lists that share a backfill', async () => {
    const analysis = deferred<PetFrameMetadata>();
    const analyzer = vi.fn((_file: File) => analysis.promise);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());

    const first = await repository.list();
    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());
    const second = await repository.list();
    await nextTask();
    await nextTask();

    expect(first[0]).not.toBe(second[0]);
    first[0]!.displayName = 'Changed in first result';
    expect(second[0]?.displayName).toBe(MURK_TEST_PET.displayName);
    analysis.resolve(frameMetadata);
    await vi.waitFor(async () => {
      const third = await repository.list();
      expect(third[0]?.displayName).toBe(MURK_TEST_PET.displayName);
      expect(third[0]?.frameMetadata?.animationColumns.idle).toEqual([0]);
    });
  });

  test('bounds revision and analysis work and persists every queued backfill', async () => {
    const revisions = [deferred<string>(), deferred<string>(), deferred<string>()];
    let activeRevisions = 0;
    let maximumActiveRevisions = 0;
    const revisioner = vi.fn(async () => {
      const index = revisioner.mock.calls.length - 1;
      activeRevisions += 1;
      maximumActiveRevisions = Math.max(maximumActiveRevisions, activeRevisions);
      const revision = await revisions[index]!.promise;
      activeRevisions -= 1;
      return revision;
    });
    const analyzer = vi.fn(async () => frameMetadata);
    const databaseName = 'bounded-backfills';
    const repository = createIndexedDbPetRepository(factory, databaseName, analyzer, revisioner);
    await seedStoredPet(factory, databaseName, { ...legacyPet(), id: 'one' });
    await seedStoredPet(factory, databaseName, { ...legacyPet(), id: 'two' });
    await seedStoredPet(factory, databaseName, { ...legacyPet(), id: 'three' });

    await repository.list();
    await vi.waitFor(() => expect(revisioner).toHaveBeenCalledTimes(2));
    await nextTask();
    expect(revisioner).toHaveBeenCalledTimes(2);
    expect(analyzer).not.toHaveBeenCalled();

    revisions[0]!.resolve('revision-one');
    await vi.waitFor(() => expect(revisioner).toHaveBeenCalledTimes(3));
    revisions[1]!.resolve('revision-two');
    revisions[2]!.resolve('revision-three');
    await vi.waitFor(async () => {
      const pets = await repository.list();
      expect(pets).toHaveLength(3);
      expect(pets.every(({ frameMetadata, atlasRevision }) => (
        frameMetadata !== undefined && atlasRevision !== undefined
      ))).toBe(true);
    });
    expect(maximumActiveRevisions).toBe(2);
    expect(analyzer).toHaveBeenCalledTimes(3);
  });

  test('never writes stale metadata into a same-id replacement and analyzes its new revision', async () => {
    const originalAnalysis = deferred<PetFrameMetadata>();
    const replacementAnalysis = deferred<PetFrameMetadata>();
    const analyzer = vi.fn()
      .mockReturnValueOnce(originalAnalysis.promise)
      .mockReturnValueOnce(replacementAnalysis.promise);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    const originalBlob = new NodeBlob(['original-atlas'], { type: 'image/webp' }) as Blob;
    const replacementBlob = new NodeBlob(['replaced-atlas'], { type: 'image/webp' }) as Blob;
    expect(originalBlob.size).toBe(replacementBlob.size);
    await repository.put({
      ...legacyPet(),
      spritesheet: originalBlob,
      updatedAt: 999,
    });
    const [listedOriginal] = await repository.list();
    expect(listedOriginal).not.toHaveProperty('frameMetadata');
    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());

    await repository.put({
      ...legacyPet(),
      displayName: 'Murk Replacement',
      spritesheet: replacementBlob,
      updatedAt: 999,
    });
    originalAnalysis.resolve(frameMetadata);

    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledTimes(2));
    const [beforeReplacementAnalysis] = await repository.list();
    expect(beforeReplacementAnalysis).toMatchObject({
      displayName: 'Murk Replacement',
      updatedAt: 999,
    });
    expect(beforeReplacementAnalysis).not.toHaveProperty('frameMetadata');
    expect(await beforeReplacementAnalysis!.spritesheet.text()).toBe('replaced-atlas');

    replacementAnalysis.resolve(replacementFrameMetadata);
    await vi.waitFor(async () => {
      const [persisted] = await repository.list();
      expect(persisted).toMatchObject({
        displayName: 'Murk Replacement',
        updatedAt: 999,
        frameMetadata: replacementFrameMetadata,
      });
      expect(await persisted!.spritesheet.text()).toBe('replaced-atlas');
    });
  });

  test('does not return or recreate a pet deleted while analysis is in flight', async () => {
    const analysis = deferred<PetFrameMetadata>();
    const analyzer = vi.fn((_file: File) => analysis.promise);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());
    const listing = await repository.list();
    await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());

    await repository.delete(MURK_TEST_PET.id);
    analysis.resolve(frameMetadata);

    expect(listing).toHaveLength(1);
    await expect(repository.list()).resolves.toEqual([]);
  });

  test('preserves Blob name, type, and bytes in the analyzer File adapter', async () => {
    vi.stubGlobal('File', NodeFile);
    try {
      const spritesheet = new NodeBlob(['legacy-webp-bytes'], { type: 'image/webp' }) as Blob;
      const analyzer = vi.fn(async (file: File) => {
        expect(file.name).toBe('legacy.webp');
        expect(file.type).toBe('image/webp');
        expect(await file.text()).toBe('legacy-webp-bytes');
        return frameMetadata;
      });
      const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
      await repository.put({
        ...legacyPet(),
        spritesheetFilename: 'legacy.webp',
        spritesheet,
      });

      await expect(repository.list()).resolves.toEqual([
        expect.not.objectContaining({ frameMetadata: expect.anything() }),
      ]);
      await vi.waitFor(() => expect(analyzer).toHaveBeenCalledOnce());
      await vi.waitFor(async () => {
        expect((await repository.list())[0]?.frameMetadata).toEqual(frameMetadata);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('does not reanalyze records that already contain frame metadata', async () => {
    const analyzer = vi.fn(async () => frameMetadata);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(MURK_TEST_PET);

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ frameMetadata: MURK_TEST_PET.frameMetadata }),
    ]);
    expect(analyzer).not.toHaveBeenCalled();
  });

  test('returns the pet when analysis fails', async () => {
    const analyzer = vi.fn(async () => { throw new Error('analysis failed'); });
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());

    await expect(repository.list()).resolves.toEqual([
      expect.not.objectContaining({ frameMetadata: expect.anything() }),
    ]);
    await nextTask();
    await nextTask();
  });

  test('returns the pet when metadata backfill fails', async () => {
    const uncloneableMetadata = {
      ...frameMetadata,
      unsupportedIndexedDbValue: () => undefined,
    } as PetFrameMetadata;
    const analyzer = vi.fn(async () => uncloneableMetadata);
    const repository = createIndexedDbPetRepository(factory, undefined, analyzer);
    await repository.put(legacyPet());

    await expect(repository.list()).resolves.toEqual([
      expect.not.objectContaining({ frameMetadata: expect.anything() }),
    ]);
    await nextTask();
    await nextTask();
  });

  test('delete removes only the requested pet', async () => {
    const repository = createIndexedDbPetRepository(factory);
    await repository.put(withPet({ id: 'keep', displayName: 'Keep' }));
    await repository.put(withPet({ id: 'remove', displayName: 'Remove' }));

    await repository.delete('remove');

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: 'keep' }),
    ]);
  });

  test('clear empties the pet store', async () => {
    const repository = createIndexedDbPetRepository(factory);
    await repository.put(MURK_TEST_PET);

    await repository.clear();

    await expect(repository.list()).resolves.toEqual([]);
  });

  test('open errors reject with the underlying failure', async () => {
    const failure = new Error('open failed');
    const repository = createIndexedDbPetRepository(createOpenFailureFactory(failure));

    await expect(repository.list()).rejects.toBe(failure);
  });

  test('transaction errors reject instead of returning partial data', async () => {
    const failure = new Error('transaction aborted');
    const repository = createIndexedDbPetRepository(createTransactionAbortFactory(failure));

    await expect(repository.list()).rejects.toBe(failure);
  });
});
