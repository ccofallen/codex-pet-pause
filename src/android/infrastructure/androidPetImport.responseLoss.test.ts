import { describe, expect, test, vi } from 'vitest';
import type {
  AndroidPetArchiveEvent,
  AndroidPetImportHost,
} from '../bridge/androidHost';
import { createAndroidPetImport } from './androidPetImport';

describe('Android pending import response-loss recovery', () => {
  test('clears the active token after idempotent retry and delivers the next FIFO token once', async () => {
    let announce: ((event: AndroidPetArchiveEvent) => void) | undefined;
    let firstResponseLost = true;
    const completePendingArchive = vi.fn(async (token: string) => {
      if (token === 'first-token' && firstResponseLost) {
        firstResponseLost = false;
        announce?.({ type: 'pet-archive-ready', token: 'second-token' });
        throw new Error('native response lost after successful acknowledgement');
      }
    });
    const host: AndroidPetImportHost = {
      openPetdex: async () => undefined,
      pickPetFiles: async () => ({ status: 'cancelled', files: [] }),
      consumePendingArchive: async () => { throw new Error('not used'); },
      completePendingArchive,
      persistValidatedPet: async () => undefined,
      subscribePetArchives(listener) {
        announce = listener;
        return () => { announce = undefined; };
      },
    };
    const petImport = createAndroidPetImport(host);
    const delivered: string[] = [];
    petImport.subscribe(({ token }) => delivered.push(token));

    announce?.({ type: 'pet-archive-ready', token: 'first-token' });
    await petImport.completePendingArchive('first-token', 'imported');

    expect(completePendingArchive).toHaveBeenCalledTimes(2);
    expect(delivered).toEqual(['first-token', 'second-token']);
    await expect(petImport.completePendingArchive('second-token', 'cancelled')).resolves.toBeUndefined();
  });
});
