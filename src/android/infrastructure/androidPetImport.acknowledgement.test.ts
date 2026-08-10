import { expect, test, vi } from 'vitest';
import type {
  AndroidPetArchiveEvent, AndroidPetImportHost,
} from '../bridge/androidHost';
import {
  createAndroidPetImport, type AndroidPetImportEvent,
} from './androidPetImport';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function archiveHost(
  installListener: (listener: (event: AndroidPetArchiveEvent) => void) => void,
  completePendingArchive: (token: string, outcome: string) => Promise<void>,
): AndroidPetImportHost {
  return {
    subscribePetArchives(listener: (event: AndroidPetArchiveEvent) => void) {
      installListener(listener);
      return () => undefined;
    },
    completePendingArchive,
  } as unknown as AndroidPetImportHost;
}

test('does not redeliver a token to a remounted page while its acknowledgement is pending', async () => {
  const acknowledgement = deferred<void>();
  let nativeListener!: (event: AndroidPetArchiveEvent) => void;
  const petImport = createAndroidPetImport(archiveHost(
    (listener) => { nativeListener = listener; },
    () => acknowledgement.promise,
  ));
  let firstClaim: AndroidPetImportEvent | undefined;
  const unsubscribe = petImport.subscribe((event) => { firstClaim = event; });
  nativeListener({ type: 'pet-archive-ready', token: 'ack-remount' });

  const completion = petImport.completePendingArchive(
    'ack-remount',
    'cancelled',
    firstClaim,
  );
  unsubscribe();
  const remountedListener = vi.fn();
  petImport.subscribe(remountedListener);

  expect(remountedListener).not.toHaveBeenCalled();
  acknowledgement.resolve();
  await completion;
  expect(remountedListener).not.toHaveBeenCalled();
});

test('does not send a conflicting retry when disposed during acknowledgement', async () => {
  const acknowledgement = deferred<void>();
  let nativeListener!: (event: AndroidPetArchiveEvent) => void;
  const completePendingArchive = vi.fn((token: string, outcome: string) =>
    outcome === 'imported' ? acknowledgement.promise : Promise.resolve());
  const petImport = createAndroidPetImport(archiveHost(
    (listener) => { nativeListener = listener; },
    completePendingArchive,
  ));
  let claim: AndroidPetImportEvent | undefined;
  petImport.subscribe((event) => { claim = event; });
  nativeListener({ type: 'pet-archive-ready', token: 'ack-dispose' });

  const completion = petImport.completePendingArchive('ack-dispose', 'imported', claim);
  petImport.dispose();

  expect(completePendingArchive).toHaveBeenCalledTimes(1);
  expect(completePendingArchive).toHaveBeenCalledWith('ack-dispose', 'imported');
  acknowledgement.resolve();
  await completion;
  expect(completePendingArchive).toHaveBeenCalledTimes(1);
});
