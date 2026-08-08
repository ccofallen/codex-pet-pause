import type { StoredCodexPet } from '../../features/pets/domain/types';
import type {
  AndroidNativePetFile,
  AndroidHostSnapshot,
  AndroidPetArchiveEvent,
  AndroidPetImportHost,
  AndroidPetPersistResult,
  AndroidPendingArchiveOutcome,
  AndroidPetWrite,
} from '../bridge/androidHost';
import { readAndroidBlobBytes } from './androidRepositories';

export type AndroidPetImportEvent = AndroidPetArchiveEvent;

export interface AndroidPetImport {
  openPetdex(): Promise<void>;
  pickFiles(): Promise<File[]>;
  consumePendingArchive(token: string): Promise<File>;
  completePendingArchive(token: string, outcome: AndroidPendingArchiveOutcome): Promise<void>;
  persistValidatedPet(pet: StoredCodexPet): Promise<AndroidPetPersistResult | void>;
  subscribe(listener: (event: AndroidPetImportEvent) => void): () => void;
}

function decodeBase64(value: string): ArrayBuffer {
  const text = atob(value);
  const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function nativeFile(value: AndroidNativePetFile): File {
  return new File([decodeBase64(value.base64)], value.name, { type: value.mimeType });
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function createAndroidPetImport(
  host: AndroidPetImportHost,
  applyCommittedSnapshot?: (snapshot: AndroidHostSnapshot) => void,
): AndroidPetImport {
  let listener: ((event: AndroidPetImportEvent) => void) | undefined;
  let activeToken: string | undefined;
  const queuedTokens: string[] = [];
  const knownTokens = new Set<string>();

  const deliverNext = (): void => {
    if (listener === undefined || activeToken !== undefined) return;
    const token = queuedTokens.shift();
    if (token === undefined) return;
    activeToken = token;
    listener({ type: 'pet-archive-ready', token });
  };

  return {
    openPetdex: () => host.openPetdex(),

    async pickFiles(): Promise<File[]> {
      const selection = await host.pickPetFiles();
      return selection.status === 'cancelled' ? [] : selection.files.map(nativeFile);
    },

    async consumePendingArchive(token: string): Promise<File> {
      return nativeFile(await host.consumePendingArchive(token));
    },

    async completePendingArchive(token, outcome): Promise<void> {
      if (activeToken !== token) throw new Error('Android pending archive is not active');
      try {
        await host.completePendingArchive(token, outcome);
      } catch {
        await host.completePendingArchive(token, outcome);
      }
      activeToken = undefined;
      if (outcome === 'retry') {
        queuedTokens.length = 0;
        knownTokens.clear();
        return;
      }
      knownTokens.delete(token);
      deliverNext();
    },

    async persistValidatedPet(pet: StoredCodexPet): Promise<AndroidPetPersistResult | void> {
      const { spritesheet, ...metadata } = pet;
      const bytes = new Uint8Array(await readAndroidBlobBytes(spritesheet));
      if (bytes.byteLength === 0) throw new Error('empty Android pet spritesheet');
      const input: AndroidPetWrite = {
        id: pet.id,
        metadataJson: JSON.stringify(metadata),
        spritesheetBase64: encodeBase64(bytes),
      };
      const result = await host.persistValidatedPet(input);
      if (result !== undefined) applyCommittedSnapshot?.(result.snapshot);
      return result;
    },

    subscribe(nextListener): () => void {
      if (listener !== undefined) throw new Error('Android pending archive listener already installed');
      listener = nextListener;
      const unsubscribe = host.subscribePetArchives((event) => {
        if (knownTokens.has(event.token)) return;
        knownTokens.add(event.token);
        queuedTokens.push(event.token);
        deliverNext();
      });
      return () => {
        const token = activeToken;
        listener = undefined;
        activeToken = undefined;
        queuedTokens.length = 0;
        knownTokens.clear();
        unsubscribe();
        if (token !== undefined) void host.completePendingArchive(token, 'retry').catch(() => undefined);
      };
    },
  };
}
