import { BUILTIN_PET_ID } from '../../features/pets/domain/types';
import type { AndroidControlHost, AndroidPetCatalogEntry } from '../bridge/androidHost';
import type {
  AndroidCatalogPet, AndroidPetCatalogSession, AndroidPetCatalogState,
} from '../domain/petCatalog';

function parseMetadata(entry: AndroidPetCatalogEntry): AndroidCatalogPet {
  let metadata: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(entry.metadataJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    metadata = parsed as Record<string, unknown>;
  } catch {
    throw new Error('invalid Android pet metadata');
  }
  if (metadata.id !== entry.id
    || typeof metadata.displayName !== 'string'
    || (metadata.spriteVersion !== 1 && metadata.spriteVersion !== 2)
    || typeof metadata.spritesheetFilename !== 'string'
    || typeof metadata.importedAt !== 'number'
    || !Number.isFinite(metadata.importedAt)
    || typeof metadata.updatedAt !== 'number'
    || !Number.isFinite(metadata.updatedAt)) {
    throw new Error('invalid Android pet metadata');
  }
  return {
    ...metadata,
    id: entry.id,
    assetKind: 'catalog',
    atlasRevision: entry.assetRevision,
  } as AndroidCatalogPet;
}

function thumbnailBlob(value: string): Blob {
  const text = atob(value);
  const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

export function createAndroidPetCatalog(host: AndroidControlHost): AndroidPetCatalogSession {
  let disposed = false;
  let generation = 0;
  let urlsByPetId = new Map<string, string>();
  let selectionTail = Promise.resolve();

  const release = (urls: Iterable<string>): void => {
    for (const url of urls) URL.revokeObjectURL(url);
  };

  return {
    async load(): Promise<AndroidPetCatalogState | undefined> {
      const requestGeneration = ++generation;
      if (host.loadPetCatalog === undefined) throw new Error('Android pet catalog unavailable');
      const snapshot = await host.loadPetCatalog().catch((error: unknown) => {
        if (disposed || requestGeneration !== generation) return undefined;
        throw error;
      });
      if (disposed || requestGeneration !== generation) return undefined;

      const nextUrls = new Map<string, string>();
      try {
        const pets = (snapshot?.pets ?? []).map((entry) => {
          const pet = parseMetadata(entry);
          if (entry.thumbnailBase64 === null) return pet;
          const thumbnailUrl = URL.createObjectURL(thumbnailBlob(entry.thumbnailBase64));
          nextUrls.set(entry.id, thumbnailUrl);
          return { ...pet, thumbnailUrl };
        });
        if (disposed || requestGeneration !== generation) {
          release(nextUrls.values());
          return undefined;
        }
        release(urlsByPetId.values());
        urlsByPetId = nextUrls;
        return {
          revision: snapshot?.revision ?? 0,
          activePetId: snapshot?.activePetId ?? BUILTIN_PET_ID,
          pets,
        };
      } catch (error) {
        release(nextUrls.values());
        throw error;
      }
    },

    select(id): Promise<void> {
      const result = selectionTail.then(() => host.selectPet(id));
      selectionTail = result.catch(() => undefined);
      return result;
    },

    async delete(id): Promise<void> {
      await host.deletePet(id);
      const url = urlsByPetId.get(id);
      if (url !== undefined) {
        URL.revokeObjectURL(url);
        urlsByPetId.delete(id);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      release(urlsByPetId.values());
      urlsByPetId = new Map();
    },
  };
}
