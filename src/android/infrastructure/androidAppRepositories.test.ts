import { expect, test, vi } from 'vitest';
import { createAppController } from '../../app/appController';
import { createDefaultSettings } from '../../app/defaults';
import { createFakeDependencies } from '../../test/fakes';
import type { AndroidTypedControlHost } from '../bridge/androidHost';
import { createAndroidRuntimeRepository } from './androidRuntimeRepository';
import { createAndroidAppRepositories } from './androidRepositories';

test('production Android hydration leaves the pet catalog unloaded until its page mounts', async () => {
  const settings = createDefaultSettings(10, 'en');
  const loadSnapshot = vi.fn(async () => { throw new Error('full snapshot must not load'); });
  const loadRuntimeSnapshot = vi.fn(async () => ({ revision: 4, settings, history: [] }));
  const loadPetCatalog = vi.fn(async () => ({ revision: 4, activePetId: 'builtin-cat', pets: [] }));
  const host = {
    loadSnapshot,
    loadRuntimeSnapshot,
    loadPetCatalog,
    saveSettings: vi.fn(async () => undefined),
    clearSettings: vi.fn(async () => undefined),
    appendHistory: vi.fn(async () => undefined),
    replaceHistory: vi.fn(async () => undefined),
    pruneHistory: vi.fn(async () => undefined),
    clearHistory: vi.fn(async () => undefined),
    savePet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined),
    clearPets: vi.fn(async () => undefined),
    selectPet: vi.fn(async () => undefined),
  } as unknown as AndroidTypedControlHost;
  const runtime = createAndroidRuntimeRepository(host);
  const repositories = createAndroidAppRepositories(host, runtime, () => settings);
  const fallbacks = createFakeDependencies({ now: 10 });
  const controller = createAppController({
    ...fallbacks,
    settings: repositories.settings,
    history: repositories.history,
    pets: repositories.pets,
  });

  await controller.hydrate();

  expect(loadSnapshot).not.toHaveBeenCalled();
  expect(loadRuntimeSnapshot).toHaveBeenCalled();
  expect(loadPetCatalog).not.toHaveBeenCalled();
  expect(controller.getSnapshot().ready).toBe(true);
});
