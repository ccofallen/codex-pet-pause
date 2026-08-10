import { expect, test, vi } from 'vitest';
import type { AndroidPetCatalogSnapshot, AndroidTypedControlHost } from '../bridge/androidHost';
import { createAndroidPetCatalog } from './androidPetCatalog';

const catalogSnapshot = (id = 'momo'): AndroidPetCatalogSnapshot => ({
  revision: 4,
  activePetId: id,
  pets: [{
    id,
    metadataJson: JSON.stringify({
      id,
      displayName: id === 'momo' ? 'Momo' : 'Lulu',
      spriteVersion: 2,
      spritesheetFilename: `${id}.webp`,
      importedAt: 10,
      updatedAt: 20,
    }),
    assetRevision: '0123456789abcdef0123456789abcdef',
    thumbnailBase64: 'dGlueQ==',
  }],
});

function catalogHost(loadPetCatalog: () => Promise<AndroidPetCatalogSnapshot | null>) {
  return {
    loadPetCatalog,
    selectPet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined),
  } as unknown as AndroidTypedControlHost;
}

test('rejects a catalog result that completes after the mount session is disposed', async () => {
  let resolveLoad!: (snapshot: AndroidPetCatalogSnapshot) => void;
  const loadPetCatalog = vi.fn(() => new Promise<AndroidPetCatalogSnapshot>((resolve) => {
    resolveLoad = resolve;
  }));
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale');
  const catalog = createAndroidPetCatalog(catalogHost(loadPetCatalog));

  const pending = catalog.load();
  catalog.dispose();
  resolveLoad(catalogSnapshot());

  await expect(pending).resolves.toBeUndefined();
  expect(createObjectURL).not.toHaveBeenCalled();
});

test('releases every thumbnail URL owned by the mount session', async () => {
  vi.spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:momo')
    .mockReturnValueOnce('blob:lulu');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const host = catalogHost(async () => ({
    revision: 5,
    activePetId: 'momo',
    pets: [...catalogSnapshot('momo').pets, ...catalogSnapshot('lulu').pets],
  }));
  const catalog = createAndroidPetCatalog(host);

  await expect(catalog.load()).resolves.toMatchObject({
    activePetId: 'momo',
    pets: [{ id: 'momo', thumbnailUrl: 'blob:momo' }, { id: 'lulu', thumbnailUrl: 'blob:lulu' }],
  });
  catalog.dispose();

  expect(revokeObjectURL.mock.calls).toEqual([['blob:momo'], ['blob:lulu']]);
});

test('ignores an older rejected load after a newer catalog load succeeds', async () => {
  let rejectOlder!: (reason: Error) => void;
  let resolveNewer!: (snapshot: AndroidPetCatalogSnapshot) => void;
  const host = catalogHost(vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOlder = reject; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; })));
  const catalog = createAndroidPetCatalog(host);

  const older = catalog.load();
  const newer = catalog.load();
  resolveNewer(catalogSnapshot('lulu'));
  await expect(newer).resolves.toMatchObject({ activePetId: 'lulu' });
  rejectOlder(new Error('stale retry failed'));

  await expect(older).resolves.toBeUndefined();
});
