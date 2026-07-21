import { describe, expect, test } from 'vitest';

import { createFakeDependencies, FakePetRepository } from './fakes';
import { MURK_TEST_PET } from './petFixtures';

describe('FakePetRepository', () => {
  test('lists pets in display-name order', async () => {
    const repository = new FakePetRepository();
    repository.values.set('zebra', { ...MURK_TEST_PET, id: 'zebra', displayName: 'Zebra' });
    repository.values.set('alpaca', { ...MURK_TEST_PET, id: 'alpaca', displayName: 'Alpaca' });

    const listed = await repository.list();

    expect(listed.map(({ displayName }) => displayName)).toEqual(['Alpaca', 'Zebra']);
  });

  test('returns clones that cannot mutate map-owned records', async () => {
    const repository = new FakePetRepository();
    repository.values.set(MURK_TEST_PET.id, MURK_TEST_PET);

    const [listed] = await repository.list();
    listed!.displayName = 'Changed outside the repository';

    expect(repository.values.get(MURK_TEST_PET.id)?.displayName).toBe('Murk');
  });
});

test('passes an optional locale through fake controller dependencies', () => {
  expect(createFakeDependencies({ now: 0, defaultLocale: 'en' }).defaultLocale).toBe('en');
});
