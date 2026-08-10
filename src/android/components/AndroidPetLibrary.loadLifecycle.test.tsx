import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { PetLibraryCatalog } from '../../features/pets/components/PetLibrary';
import type { AndroidControlHost } from '../bridge/androidHost';
import type { AndroidPetImport } from '../infrastructure/androidPetImport';

const catalogCapture = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('../../app/AppProvider', () => ({
  useAppSnapshot: () => ({ settings: { activePetId: 'momo' } }),
}));

vi.mock('../../features/pets/components/PetLibrary', () => ({
  PetLibrary: ({ catalog }: { catalog: unknown }) => {
    catalogCapture.current = catalog;
    return null;
  },
}));

import { AndroidPetLibrary } from './AndroidPetLibrary';

afterEach(() => {
  cleanup();
  catalogCapture.current = undefined;
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function snapshot(revision: number, activePetId: string) {
  return { revision, activePetId, pets: [] };
}

function catalog(): PetLibraryCatalog {
  return catalogCapture.current as PetLibraryCatalog;
}

const androidImport = {} as AndroidPetImport;

test('queues the required post-import refresh behind a deferred initial catalog load', async () => {
  const initialLoad = deferred<ReturnType<typeof snapshot>>();
  const loadPetCatalog = vi.fn()
    .mockImplementationOnce(() => initialLoad.promise)
    .mockResolvedValueOnce(snapshot(2, 'imported-pet'));
  const host = { loadPetCatalog } as unknown as AndroidControlHost;
  render(<AndroidPetLibrary host={host} androidImport={androidImport} />);
  await waitFor(() => expect(loadPetCatalog).toHaveBeenCalledTimes(1));

  const postImportRefresh = catalog().refresh();
  await act(async () => {
    initialLoad.resolve(snapshot(1, 'momo'));
    await initialLoad.promise;
    await postImportRefresh;
  });

  await waitFor(() => expect(loadPetCatalog).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(catalog().activePetId).toBe('imported-pet'));
});

test('starts the replacement host initial load while the previous host load is pending', async () => {
  const oldLoad = deferred<ReturnType<typeof snapshot>>();
  const oldHostLoad = vi.fn(() => oldLoad.promise);
  const replacementHostLoad = vi.fn(async () => snapshot(2, 'replacement-pet'));
  const oldHost = { loadPetCatalog: oldHostLoad } as unknown as AndroidControlHost;
  const replacementHost = {
    loadPetCatalog: replacementHostLoad,
  } as unknown as AndroidControlHost;
  const view = render(<AndroidPetLibrary host={oldHost} androidImport={androidImport} />);
  await waitFor(() => expect(oldHostLoad).toHaveBeenCalledTimes(1));

  view.rerender(<AndroidPetLibrary host={replacementHost} androidImport={androidImport} />);

  await waitFor(() => expect(replacementHostLoad).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(catalog().activePetId).toBe('replacement-pet'));
  oldLoad.resolve(snapshot(1, 'momo'));
});

test('does not let an older catalog refresh overwrite a newer pet selection', async () => {
  const staleRefresh = deferred<ReturnType<typeof snapshot>>();
  const nativeSelection = deferred<void>();
  const loadPetCatalog = vi.fn()
    .mockResolvedValueOnce(snapshot(1, 'momo'))
    .mockImplementationOnce(() => staleRefresh.promise);
  const selectPet = vi.fn(() => nativeSelection.promise);
  const host = { loadPetCatalog, selectPet } as unknown as AndroidControlHost;
  render(<AndroidPetLibrary host={host} androidImport={androidImport} />);
  await waitFor(() => expect(catalog().activePetId).toBe('momo'));

  let refresh!: Promise<void>;
  act(() => { refresh = catalog().refresh(); });
  await waitFor(() => expect(loadPetCatalog).toHaveBeenCalledTimes(2));
  let selection!: Promise<void>;
  act(() => { selection = catalog().selectPet('builtin-cat'); });
  await waitFor(() => expect(catalog().activePetId).toBe('builtin-cat'));

  await act(async () => {
    staleRefresh.resolve(snapshot(1, 'momo'));
    await staleRefresh.promise;
    await refresh;
  });

  expect(catalog().activePetId).toBe('builtin-cat');
  await act(async () => {
    nativeSelection.resolve();
    await selection;
  });
});

test('preserves a selection made before the initial catalog load resolves', async () => {
  const initialLoad = deferred<ReturnType<typeof snapshot>>();
  const nativeSelection = deferred<void>();
  const host = {
    loadPetCatalog: vi.fn(() => initialLoad.promise),
    selectPet: vi.fn(() => nativeSelection.promise),
  } as unknown as AndroidControlHost;
  render(<AndroidPetLibrary host={host} androidImport={androidImport} />);
  await waitFor(() => expect(host.loadPetCatalog).toHaveBeenCalledTimes(1));

  act(() => { void catalog().selectPet('builtin-cat'); });
  await waitFor(() => expect(catalog().selectionPendingId).toBe('builtin-cat'));
  await act(async () => {
    initialLoad.resolve(snapshot(1, 'momo'));
    await initialLoad.promise;
  });

  expect(catalog().activePetId).toBe('builtin-cat');
  await act(async () => {
    nativeSelection.resolve();
  });
});

test('clears a pending selection when a replacement host invalidates its session', async () => {
  const nativeSelection = deferred<void>();
  const oldHost = {
    loadPetCatalog: vi.fn(async () => snapshot(1, 'momo')),
    selectPet: vi.fn(() => nativeSelection.promise),
  } as unknown as AndroidControlHost;
  const replacementHost = {
    loadPetCatalog: vi.fn(async () => snapshot(2, 'builtin-cat')),
  } as unknown as AndroidControlHost;
  const view = render(<AndroidPetLibrary host={oldHost} androidImport={androidImport} />);
  await waitFor(() => expect(catalog().activePetId).toBe('momo'));

  act(() => { void catalog().selectPet('builtin-cat'); });
  await waitFor(() => expect(catalog().selectionPendingId).toBe('builtin-cat'));

  view.rerender(<AndroidPetLibrary host={replacementHost} androidImport={androidImport} />);

  await waitFor(() => expect(catalog().activePetId).toBe('builtin-cat'));
  await waitFor(() => expect(catalog().selectionPendingId).toBeUndefined());
});
