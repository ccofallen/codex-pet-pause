import { decodeBrowserImage } from '../features/pets/domain/importPet';
import type { PetFrameMetadata, StoredCodexPet } from '../features/pets/domain/types';

export interface PetRepository {
  list(): Promise<StoredCodexPet[]>;
  put(value: StoredCodexPet): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const PET_DB = 'codex-pet-pause-pets';
export const PET_STORE = 'pets';
const PET_DB_VERSION = 1;
const MAX_CONCURRENT_BACKFILLS = 2;

export type PetFrameAnalyzer = (file: File) => Promise<PetFrameMetadata | undefined>;
export type PetRevisioner = (pet: StoredCodexPet) => Promise<string>;
export type AtlasDigest = (bytes: ArrayBuffer) => Promise<ArrayBuffer>;

export type CreatePetRepository = (
  factory: IDBFactory,
  databaseName?: string,
  analyze?: PetFrameAnalyzer,
  revision?: PetRevisioner,
) => PetRepository;

const analyzePetFrames: PetFrameAnalyzer = async (file) =>
  (await decodeBrowserImage(file)).frameMetadata;

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, PET_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PET_STORE)) {
        request.result.createObjectStore(PET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open pet library'));
    request.onblocked = () => reject(new Error('Pet library database is blocked'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Pet library transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Pet library transaction aborted'));
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Pet library request failed'));
  });
}

function clonePet(value: StoredCodexPet): StoredCodexPet {
  try {
    return structuredClone(value);
  } catch {
    const { frameMetadata, ...petWithoutFrameMetadata } = value;
    return {
      ...structuredClone(petWithoutFrameMetadata),
      ...(frameMetadata === undefined ? {} : {
        frameMetadata: {
          ...frameMetadata,
          animationColumns: Object.fromEntries(
            Object.entries(frameMetadata.animationColumns)
              .map(([animation, columns]) => [animation, [...columns]]),
          ) as PetFrameMetadata['animationColumns'],
          ...(frameMetadata.visibleLookDirections === undefined ? {} : {
            visibleLookDirections: [...frameMetadata.visibleLookDirections],
          }),
        },
      }),
    };
  }
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read pet atlas'));
    reader.readAsArrayBuffer(blob);
  });
}

function fallbackFingerprint(bytes: ArrayBuffer): string {
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of new Uint8Array(bytes)) {
    first = BigInt.asUintN(64, (first ^ BigInt(byte)) * 0x100000001b3n);
    second = BigInt.asUintN(64, (second ^ BigInt(byte + 1)) * 0x100000001b3n);
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`;
}

export async function atlasContentFingerprint(
  bytes: ArrayBuffer,
  digest: AtlasDigest | null = globalThis.crypto?.subtle === undefined
    ? null
    : (value) => globalThis.crypto.subtle.digest('SHA-256', value),
): Promise<string> {
  if (digest !== null) {
    try {
      const result = await digest(bytes);
      return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Some embedded browsers expose SubtleCrypto but reject digest operations.
    }
  }
  return fallbackFingerprint(bytes);
}

const petRevision: PetRevisioner = async (value) => {
  const contentHash = await atlasContentFingerprint(await readBlobBytes(value.spritesheet));
  return [
    value.id,
    value.updatedAt,
    value.spriteVersion,
    value.spritesheetFilename,
    value.spritesheet.type,
    value.spritesheet.size,
    contentHash,
  ].join('\u0000');
};

function stableSourceKey(value: StoredCodexPet): string {
  return [
    value.id,
    value.updatedAt,
    value.spriteVersion,
    value.spritesheetFilename,
    value.spritesheet.type,
    value.spritesheet.size,
  ].join('\u0000');
}

async function writePet(database: IDBDatabase, value: StoredCodexPet): Promise<void> {
  const transaction = database.transaction(PET_STORE, 'readwrite');
  const completion = waitForTransaction(transaction);
  try {
    transaction.objectStore(PET_STORE).put(value);
  } catch (error) {
    transaction.abort();
    await completion.catch(() => undefined);
    throw error;
  }
  await completion;
}

function mergeFrameMetadata(
  database: IDBDatabase,
  sourcePet: StoredCodexPet,
  sourceRevision: string,
  frameMetadata: PetFrameMetadata,
): Promise<StoredCodexPet | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PET_STORE, 'readwrite');
    const store = transaction.objectStore(PET_STORE);
    let currentPet: StoredCodexPet | undefined;

    transaction.oncomplete = () => resolve(currentPet);
    transaction.onerror = () => reject(transaction.error ?? new Error('Pet metadata backfill failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Pet metadata backfill aborted'));

    const request = store.get(sourcePet.id) as IDBRequest<StoredCodexPet | undefined>;
    request.onsuccess = () => {
      const storedPet = request.result;
      if (storedPet === undefined || storedPet.frameMetadata !== undefined) {
        currentPet = storedPet;
        return;
      }

      currentPet = storedPet;
      const revisionMatches = storedPet.atlasRevision === undefined
        ? stableSourceKey(storedPet) === stableSourceKey(sourcePet)
        : storedPet.atlasRevision === sourceRevision;
      if (!revisionMatches) return;

      currentPet = { ...storedPet, atlasRevision: sourceRevision, frameMetadata };
      try {
        store.put(currentPet);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      }
    };
  });
}

export const createIndexedDbPetRepository: CreatePetRepository = (
  factory,
  databaseName = PET_DB,
  analyze = analyzePetFrames,
  revision = petRevision,
) => {
  let databasePromise: Promise<IDBDatabase> | undefined;
  let mutationTail = Promise.resolve();
  let activeBackfills = 0;
  const queuedBackfills: Array<() => void> = [];
  const inFlightBackfills = new Map<string, Promise<void>>();
  const getDatabase = () => {
    databasePromise ??= openDatabase(factory, databaseName);
    return databasePromise;
  };
  const enqueueMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const runBackfill = <T>(operation: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const finish = (): void => {
      activeBackfills -= 1;
      queuedBackfills.shift()?.();
    };
    const start = (): void => {
      activeBackfills += 1;
      void operation().then(
        (value) => {
          resolve(value);
          finish();
        },
        (error: unknown) => {
          reject(error);
          finish();
        },
      );
    };
    if (activeBackfills < MAX_CONCURRENT_BACKFILLS) start();
    else queuedBackfills.push(start);
  });
  const backfillPet = (pet: StoredCodexPet): Promise<void> => {
    const key = stableSourceKey(pet);
    const existing = inFlightBackfills.get(key);
    if (existing !== undefined) return existing;

    let stalePet: StoredCodexPet | undefined;
    const backfill = runBackfill(async () => {
      try {
        const sourceRevision = pet.atlasRevision ?? await revision(pet);
        const file = new File([pet.spritesheet], pet.spritesheetFilename, {
          type: pet.spritesheet.type,
        });
        const frameMetadata = await analyze(file);
        if (frameMetadata === undefined) return;
        const current = await enqueueMutation(async () => mergeFrameMetadata(
          await getDatabase(), pet, sourceRevision, frameMetadata,
        ));
        if (
          current !== undefined
          && current.frameMetadata === undefined
          && (
            current.atlasRevision !== sourceRevision
            || stableSourceKey(current) !== stableSourceKey(pet)
          )
        ) {
          stalePet = current;
        }
      } catch {
        // Frame metadata is a best-effort compatibility enhancement.
      }
    });
    inFlightBackfills.set(key, backfill);
    const finish = (): void => {
      if (inFlightBackfills.get(key) === backfill) inFlightBackfills.delete(key);
      if (stalePet !== undefined) void backfillPet(stalePet).catch(() => undefined);
    };
    void backfill.then(finish, finish);
    return backfill;
  };

  return {
    async list(): Promise<StoredCodexPet[]> {
      const transaction = (await getDatabase()).transaction(PET_STORE, 'readonly');
      const completion = waitForTransaction(transaction);
      const [values] = await Promise.all([
        waitForRequest(
          transaction.objectStore(PET_STORE).getAll() as IDBRequest<StoredCodexPet[]>,
        ),
        completion,
      ]);
      const pets = values.map(clonePet)
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
      for (const pet of pets) {
        if (pet.frameMetadata === undefined) void backfillPet(clonePet(pet)).catch(() => undefined);
      }
      return pets;
    },

    async put(value: StoredCodexPet): Promise<void> {
      await enqueueMutation(async () => {
        const atlasRevision = await revision(value);
        await writePet(await getDatabase(), { ...value, atlasRevision });
      });
    },

    async delete(id: string): Promise<void> {
      await enqueueMutation(async () => {
        const transaction = (await getDatabase()).transaction(PET_STORE, 'readwrite');
        const completion = waitForTransaction(transaction);
        transaction.objectStore(PET_STORE).delete(id);
        await completion;
      });
    },

    async clear(): Promise<void> {
      await enqueueMutation(async () => {
        const transaction = (await getDatabase()).transaction(PET_STORE, 'readwrite');
        const completion = waitForTransaction(transaction);
        transaction.objectStore(PET_STORE).clear();
        await completion;
      });
    },
  };
};
