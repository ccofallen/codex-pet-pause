import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { I18nProvider } from '../../i18n/I18nProvider';
import { createFakeDependencies } from '../../test/fakes';
import type { AndroidControlHost, AndroidPetCatalogSnapshot } from '../bridge/androidHost';
import { createAndroidPetImport } from '../infrastructure/androidPetImport';
import { AndroidPetLibrary } from './AndroidPetLibrary';

function snapshot(): AndroidPetCatalogSnapshot {
  const pet = (id: string, displayName: string) => ({
    id,
    metadataJson: JSON.stringify({
      id, displayName, spriteVersion: 2, spritesheetFilename: `${id}.webp`, importedAt: 10, updatedAt: 20,
    }),
    assetRevision: '0123456789abcdef0123456789abcdef',
    thumbnailBase64: null,
  });
  return { revision: 3, activePetId: 'builtin-cat', pets: [pet('momo', 'Momo'), pet('lulu', 'Lulu')] };
}

function renderLibrary(host: AndroidControlHost) {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  return render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en">
        <AndroidPetLibrary host={host} androidImport={createAndroidPetImport(host)} />
      </I18nProvider>
    </AppProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test('keeps other pet choices responsive while an optimistic native selection is pending', async () => {
  let rejectSelection!: (reason: Error) => void;
  const selectPet = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSelection = reject; }));
  const host = {
    loadPetCatalog: vi.fn(async () => snapshot()),
    selectPet,
    deletePet: vi.fn(async () => undefined),
    subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const user = userEvent.setup();
  renderLibrary(host);

  await user.click(await screen.findByRole('button', { name: 'Use Momo' }));

  expect(screen.getByLabelText('Momo (current)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use Lulu' })).toBeEnabled();
  expect(selectPet).toHaveBeenCalledWith('momo');

  await act(async () => { rejectSelection(new Error('native selection failed')); });
  expect(await screen.findByRole('button', { name: 'Use Momo' })).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not switch pets');
});

test('suppresses an older failed selection when the queued newer selection succeeds', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const selectPet = vi.fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const host = {
    loadPetCatalog: vi.fn(async () => snapshot()), selectPet,
    deletePet: vi.fn(async () => undefined), subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const user = userEvent.setup();
  renderLibrary(host);

  await user.click(await screen.findByRole('button', { name: 'Use Momo' }));
  await user.click(screen.getByRole('button', { name: 'Use Lulu' }));
  expect(selectPet).toHaveBeenCalledTimes(1);

  await act(async () => { first.reject(new Error('older selection failed')); });
  await waitFor(() => expect(selectPet).toHaveBeenNthCalledWith(2, 'lulu'));
  await act(async () => { second.resolve(); });

  expect(await screen.findByLabelText('Lulu (current)')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('rolls a failed latest selection back to the last confirmed queued selection', async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const selectPet = vi.fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const host = {
    loadPetCatalog: vi.fn(async () => snapshot()), selectPet,
    deletePet: vi.fn(async () => undefined), subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const user = userEvent.setup();
  renderLibrary(host);

  await user.click(await screen.findByRole('button', { name: 'Use Momo' }));
  await user.click(screen.getByRole('button', { name: 'Use Lulu' }));
  expect(selectPet).toHaveBeenCalledTimes(1);

  await act(async () => { first.resolve(); });
  await waitFor(() => expect(selectPet).toHaveBeenNthCalledWith(2, 'lulu'));
  await act(async () => { second.reject(new Error('latest selection failed')); });

  expect(await screen.findByLabelText('Momo (current)')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not switch pets');
});

test('shows an initial catalog failure and retries it in the same mount session', async () => {
  const loadPetCatalog = vi.fn()
    .mockRejectedValueOnce(new Error('temporary catalog failure'))
    .mockResolvedValueOnce(snapshot());
  const host = {
    loadPetCatalog, selectPet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined), subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const user = userEvent.setup();
  renderLibrary(host);

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the pet library');
  await user.click(screen.getByRole('button', { name: 'Retry pet library' }));

  expect(await screen.findByRole('button', { name: 'Use Momo' })).toBeEnabled();
  expect(loadPetCatalog).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('rejects a retry result that finishes after the Android pet page unmounts', async () => {
  const retry = deferred<AndroidPetCatalogSnapshot>();
  const loadPetCatalog = vi.fn()
    .mockRejectedValueOnce(new Error('temporary catalog failure'))
    .mockImplementationOnce(() => retry.promise);
  const host = {
    loadPetCatalog, selectPet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined), subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-retry');
  const user = userEvent.setup();
  const view = renderLibrary(host);

  await user.click(await screen.findByRole('button', { name: 'Retry pet library' }));
  view.unmount();
  await act(async () => { retry.resolve({
    ...snapshot(),
    pets: snapshot().pets.map((pet) => ({ ...pet, thumbnailBase64: 'dGlueQ==' })),
  }); });

  expect(createObjectURL).not.toHaveBeenCalled();
});

test('disables catalog retry while its replacement load is pending', async () => {
  const retry = deferred<AndroidPetCatalogSnapshot>();
  const host = {
    loadPetCatalog: vi.fn()
      .mockRejectedValueOnce(new Error('temporary catalog failure'))
      .mockImplementationOnce(() => retry.promise),
    selectPet: vi.fn(async () => undefined), deletePet: vi.fn(async () => undefined),
    subscribePetArchives: () => () => undefined,
  } as unknown as AndroidControlHost;
  const user = userEvent.setup();
  renderLibrary(host);

  const retryButton = await screen.findByRole('button', { name: 'Retry pet library' });
  await user.click(retryButton);

  expect(retryButton).toBeDisabled();
  await user.click(retryButton);
  expect(host.loadPetCatalog).toHaveBeenCalledTimes(2);
  await act(async () => { retry.resolve(snapshot()); });
});
