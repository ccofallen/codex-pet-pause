import type { StoredCodexPet } from '../../features/pets/domain/types';
import type {
  AndroidNativePetFile,
  AndroidPetArchiveEvent,
  AndroidPetImportHost,
  AndroidPetWrite,
} from '../bridge/androidHost';
import { readAndroidBlobBytes } from './androidRepositories';

export type AndroidPetImportEvent = AndroidPetArchiveEvent;

export interface AndroidPetImport {
  openPetdex(): Promise<void>;
  pickFiles(): Promise<File[]>;
  consumePendingArchive(token: string): Promise<File>;
  persistValidatedPet(pet: StoredCodexPet): Promise<void>;
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

export function createAndroidPetImport(host: AndroidPetImportHost): AndroidPetImport {
  return {
    openPetdex: () => host.openPetdex(),

    async pickFiles(): Promise<File[]> {
      const selection = await host.pickPetFiles();
      return selection.status === 'cancelled' ? [] : selection.files.map(nativeFile);
    },

    async consumePendingArchive(token: string): Promise<File> {
      return nativeFile(await host.consumePendingArchive(token));
    },

    async persistValidatedPet(pet: StoredCodexPet): Promise<void> {
      const { spritesheet, ...metadata } = pet;
      const bytes = new Uint8Array(await readAndroidBlobBytes(spritesheet));
      if (bytes.byteLength === 0) throw new Error('empty Android pet spritesheet');
      const input: AndroidPetWrite = {
        id: pet.id,
        metadataJson: JSON.stringify(metadata),
        spritesheetBase64: encodeBase64(bytes),
      };
      await host.persistValidatedPet(input);
    },

    subscribe: (listener) => host.subscribePetArchives(listener),
  };
}
