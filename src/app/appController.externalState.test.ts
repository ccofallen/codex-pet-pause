import { expect, test } from 'vitest';
import { createDefaultSettings } from './defaults';
import { createAppController } from './appController';
import { createFakeDependencies } from '../test/fakes';
import { MURK_TEST_PET } from '../test/petFixtures';

test('applies a returned committed native state directly to the visible app snapshot', async () => {
  const controller = createAppController(createFakeDependencies({ now: 10 }));
  await controller.hydrate();
  const settings = createDefaultSettings(10, 'en');
  settings.activePetId = MURK_TEST_PET.id;

  controller.applyCommittedState?.({ settings, pets: [MURK_TEST_PET] });

  expect(controller.getSnapshot()).toMatchObject({
    settings: { activePetId: MURK_TEST_PET.id },
    pets: [{ id: MURK_TEST_PET.id }],
    storageMode: 'persistent',
  });
});
