import { afterEach, describe, expect, test, vi } from 'vitest';

import { createDefaultSettings } from '../app/defaults';
import { BUILTIN_PET_ID } from '../features/pets/domain/types';
import { isPresetReminder } from '../features/reminders/domain/types';
import { MemoryStorage } from '../test/fakes';
import { createBrowserSettingsRepository, SETTINGS_KEY } from './settingsRepository';

const NOW = Date.UTC(2026, 6, 11);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser settings repository', () => {
  test('creates defaults with the supplied locale', () => {
    expect(createDefaultSettings(0, 'en').locale).toBe('en');
  });

  test('migrates schema v1 settings to the built-in pet without losing user data', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...createDefaultSettings(NOW),
      schemaVersion: 1,
      theme: 'dark',
      affinity: 23,
      cat: { name: '团子' },
      activePetId: undefined,
    }));

    const loaded = await createBrowserSettingsRepository(storage).load();

    expect(loaded).toMatchObject({
      schemaVersion: 5,
      theme: 'dark',
      affinity: 23,
      cat: { name: '团子' },
      activePetId: BUILTIN_PET_ID,
    });
  });

  test('repairs an invalid pet position without discarding the active pet', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...createDefaultSettings(NOW),
      activePetId: 'murk',
      petPosition: { xRatio: 4, yRatio: Number.NaN },
    }));

    await expect(createBrowserSettingsRepository(storage).load()).resolves.toMatchObject({
      activePetId: 'murk',
      petPosition: { xRatio: 0.82, yRatio: 0.72 },
    });
  });

  test('round-trips valid settings and repairs invalid fields', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const expected = createDefaultSettings(NOW);

    await repo.save(expected);
    expect(await repo.load()).toEqual(expected);

    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...expected, affinity: 999 }));
    expect((await repo.load())?.affinity).toBe(100);
  });

  test('migrates schema 2 presets without restarting their cycles', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const storage = new MemoryStorage();
    const old = createDefaultSettings(NOW) as unknown as Record<string, unknown>;
    old.schemaVersion = 2;
    old.reminders = [
      { id: 'lookAway', type: 'lookAway', enabled: true, intervalMinutes: 20, nextDueAt: 123, status: 'due' },
      { id: 'drinkWater', type: 'drinkWater', enabled: true, intervalMinutes: 45, nextDueAt: 456, status: 'snoozed', snoozedUntil: 789 },
    ];
    storage.setItem(SETTINGS_KEY, JSON.stringify(old));

    const loaded = await createBrowserSettingsRepository(storage).load();
    expect(loaded?.schemaVersion).toBe(5);
    expect(loaded?.reminders.find(({ id }) => id === 'lookAway')).toMatchObject({ kind: 'preset', nextDueAt: 123, status: 'due' });
    expect(loaded?.reminders.find(({ id }) => id === 'drinkWater')).toMatchObject({ kind: 'preset', nextDueAt: 456, snoozedUntil: 789 });
  });

  test('repairs custom reminders independently and caps them at twenty', async () => {
    const storage = new MemoryStorage();
    const value = createDefaultSettings(NOW);
    const customs = Array.from({ length: 23 }, (_, index) => ({
      id: `custom-${index}`,
      kind: 'custom',
      label: ` 事项 ${index} `,
      enabled: true,
      intervalMinutes: 30,
      nextDueAt: NOW + index,
      status: 'scheduled',
    }));
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...value, reminders: [...value.reminders, ...customs] }));

    const loaded = await createBrowserSettingsRepository(storage).load();
    const repaired = loaded!.reminders.filter((item) => item.kind === 'custom');
    expect(repaired).toHaveLength(20);
    expect(repaired[0]).toMatchObject({ id: 'custom-0', label: '事项 0', nextDueAt: NOW });
  });

  test('rejects duplicate, reserved, and invalid custom reminder records', async () => {
    const storage = new MemoryStorage();
    const value = createDefaultSettings(NOW);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...value,
      reminders: [
        ...value.reminders,
        { id: ' custom-valid ', kind: 'custom', label: ' 吃药 ', enabled: true, intervalMinutes: 30, nextDueAt: 123, status: 'due' },
        { id: 'custom-valid', kind: 'custom', label: '重复', enabled: true, intervalMinutes: 45, nextDueAt: 456, status: 'scheduled' },
        { id: 'lookAway', kind: 'custom', label: '保留', enabled: true, intervalMinutes: 30, nextDueAt: 123, status: 'scheduled' },
        { id: 'custom-bad-interval', kind: 'custom', label: '错误', enabled: true, intervalMinutes: 0, nextDueAt: 123, status: 'scheduled' },
        { id: 'custom-empty-label', kind: 'custom', label: '   ', enabled: true, intervalMinutes: 30, nextDueAt: 123, status: 'scheduled' },
      ],
    }));

    const loaded = await createBrowserSettingsRepository(storage).load();
    expect(loaded?.reminders.filter((item) => item.kind === 'custom')).toEqual([
      expect.objectContaining({ id: 'custom-valid', label: '吃药', intervalMinutes: 30 }),
    ]);
  });

  test('migrates an old appearance cat to name-only without changing other settings', async () => {
    const storage = new MemoryStorage();
    const old = createDefaultSettings(1_000);
    const legacy = {
      ...old,
      theme: 'dark',
      affinity: 27,
      cat: {
        name: '  团子  ',
        coat: 'ginger',
        pattern: 'tabby',
        eyes: 'bright',
        ears: 'folded',
        tail: 'straight',
        accessory: 'scarf',
      },
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(legacy));

    const loaded = await createBrowserSettingsRepository(storage).load();

    expect(loaded?.cat).toEqual({ name: '团子' });
    expect(loaded).toMatchObject({ theme: 'dark', affinity: 27, reminders: old.reminders });
  });

  test('returns null when settings are absent or not valid JSON', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);

    await expect(repo.load()).resolves.toBeNull();
    storage.setItem(SETTINGS_KEY, '{broken');
    await expect(repo.load()).resolves.toBeNull();
  });

  test('migrates schema 3 settings without losing runtime reminder state', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const storage = new MemoryStorage();
    const defaults = createDefaultSettings(NOW);
    const schema3 = {
      ...defaults,
      schemaVersion: 3,
      locale: undefined,
      runtime: { pausedAt: NOW - 20, pausedUntil: NOW + 40, quietStartedAt: NOW - 10 },
      reminders: [
        { ...defaults.reminders[0]!, enabled: true, status: 'due' as const, nextDueAt: NOW - 1 },
        {
          ...defaults.reminders[1]!, enabled: true, status: 'snoozed' as const,
          nextDueAt: NOW + 60, snoozedUntil: NOW + 30,
        },
        ...defaults.reminders.slice(2),
        {
          id: 'custom-water', kind: 'custom' as const, label: 'Drink tea', enabled: true,
          intervalMinutes: 25, nextDueAt: NOW + 25, status: 'scheduled' as const,
        },
      ],
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(schema3));

    await expect(createBrowserSettingsRepository(storage).load()).resolves.toMatchObject({
      schemaVersion: 5,
      locale: 'zh-CN',
      runtime: schema3.runtime,
      reminders: schema3.reminders,
    });
  });

  test('uses the supplied locale only for malformed schema 4 records', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...createDefaultSettings(NOW), locale: 'not-a-locale' }));

    await expect(createBrowserSettingsRepository(storage, 'en').load())
      .resolves.toMatchObject({ schemaVersion: 5, locale: 'en', petSize: 'medium' });
  });

  test('repairs each invalid field while retaining valid sibling fields', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const defaults = createDefaultSettings(NOW);
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...defaults,
      schemaVersion: 5,
      onboardingComplete: 'yes',
      theme: 'neon',
      soundEnabled: 1,
      animationsEnabled: null,
      affinity: -5,
      quietHours: { enabled: 'yes', startMinutes: -1, endMinutes: 1440 },
      runtime: { pausedAt: Infinity, pausedUntil: NOW + 1, quietStartedAt: 'soon' },
      cat: {
        name: '', coat: 'blue', pattern: 'tabby', eyes: 'bright',
        ears: 'sideways', tail: 'straight', accessory: 'hat',
      },
      reminders: defaults.reminders.map((reminder, index) => index === 0 ? {
        ...reminder,
        id: 42,
        enabled: 'true',
        intervalMinutes: 721,
        nextDueAt: 'tomorrow',
        status: 'waiting',
        snoozedUntil: 'later',
        optionalActionDurationSeconds: 9,
      } : reminder),
    }));

    const loaded = await repo.load();

    expect(loaded).toEqual({
      ...defaults,
      runtime: {},
      cat: defaults.cat,
    });
  });

  test('repairs reminders by canonical identity across reordering, duplicates, and corrupt records', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const defaults = createDefaultSettings(NOW);
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const byType = Object.fromEntries(defaults.reminders.filter(isPresetReminder).map((item) => [item.type, item]));
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...defaults,
      reminders: [
        { ...byType.drinkWater, enabled: true, status: 'scheduled', intervalMinutes: 33 },
        { ...byType.standUp, id: 'standUp', type: 'drinkWater', intervalMinutes: 7 },
        { ...byType.lookAway, enabled: true, status: 'scheduled', intervalMinutes: 22 },
        { ...byType.drinkWater, intervalMinutes: 99 },
        byType.takeBreak,
        byType.standUp,
      ],
    }));

    const loaded = await repo.load();

    expect(loaded?.reminders.filter(isPresetReminder).map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'lookAway', type: 'lookAway' },
      { id: 'drinkWater', type: 'drinkWater' },
      { id: 'standUp', type: 'standUp' },
      { id: 'takeBreak', type: 'takeBreak' },
    ]);
    expect(loaded?.reminders.find(({ id }) => id === 'lookAway')?.intervalMinutes).toBe(22);
    expect(loaded?.reminders.find(({ id }) => id === 'drinkWater')).toMatchObject({
      enabled: true,
      intervalMinutes: 33,
    });
    expect(loaded?.reminders.find(({ id }) => id === 'standUp')?.intervalMinutes)
      .toBe(defaults.reminders.find(({ id }) => id === 'standUp')?.intervalMinutes);
  });

  test.each([
    ['orphan pausedAt', { pausedAt: NOW }],
    ['orphan pausedUntil', { pausedUntil: NOW }],
    ['reversed pause pair', { pausedAt: NOW + 1, pausedUntil: NOW }],
  ])('clears an invalid %s while preserving a valid quiet start', async (_label, runtime) => {
    const defaults = createDefaultSettings(NOW);
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...defaults,
      runtime: { ...runtime, quietStartedAt: NOW + 2 },
    }));

    expect((await repo.load())?.runtime).toEqual({ quietStartedAt: NOW + 2 });
  });

  test('preserves valid custom settings including bounded reminder values', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const settings = createDefaultSettings(NOW);
    const expected = {
      ...settings,
      theme: 'dark' as const,
      affinity: 100,
      quietHours: { enabled: true, startMinutes: 0, endMinutes: 1439 },
      runtime: { pausedAt: 0, pausedUntil: NOW, quietStartedAt: NOW + 1 },
      cat: { name: '12345678901234567890' },
      reminders: settings.reminders.map((reminder, index) => ({
        ...reminder,
        intervalMinutes: index === 0 ? 1 : 720,
        optionalActionDurationSeconds: index === 0 ? 10 : 7200,
      })),
    };

    storage.setItem(SETTINGS_KEY, JSON.stringify(expected));
    await expect(repo.load()).resolves.toEqual(expected);
  });

  test('preserves a cat name containing 20 trimmed Unicode code points', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const settings = createDefaultSettings(NOW);
    const name = '🐱'.repeat(20);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...settings,
      cat: { ...settings.cat, name },
    }));

    expect((await repo.load())?.cat.name).toBe(name);
  });

  test('normalizes surrounding whitespace before retaining a valid cat name', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const settings = createDefaultSettings(NOW);
    const normalizedName = '🐱'.repeat(20);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...settings,
      cat: { ...settings.cat, name: `   ${normalizedName}   ` },
    }));

    expect((await repo.load())?.cat.name).toBe(normalizedName);
  });

  test('repairs a cat name containing 21 trimmed Unicode code points', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const settings = createDefaultSettings(NOW);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      ...settings,
      cat: { ...settings.cat, name: '🐱'.repeat(21) },
    }));

    expect((await repo.load())?.cat.name).toBe(settings.cat.name);
  });

  test('repairs a malformed reminders collection with default reminders', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    const expected = createDefaultSettings(NOW);
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...expected, reminders: 'none' }));

    expect((await repo.load())?.reminders).toEqual(expected.reminders);
  });

  test('clear removes only the settings record', async () => {
    const storage = new MemoryStorage();
    const repo = createBrowserSettingsRepository(storage);
    storage.setItem('other', 'keep');
    await repo.save(createDefaultSettings(NOW));

    await repo.clear();

    await expect(repo.load()).resolves.toBeNull();
    expect(storage.getItem('other')).toBe('keep');
  });

  test('surfaces storage failures to the caller', async () => {
    const failure = new Error('storage unavailable');
    const storage = new MemoryStorage();
    storage.getItem = () => { throw failure; };

    await expect(createBrowserSettingsRepository(storage).load()).rejects.toBe(failure);
  });

  test('save propagates the underlying setItem failure', async () => {
    const failure = new Error('storage write unavailable');
    const storage = new MemoryStorage();
    storage.setItem = () => { throw failure; };

    await expect(createBrowserSettingsRepository(storage).save(createDefaultSettings(NOW))).rejects.toBe(failure);
  });

  test('clear propagates the underlying removeItem failure', async () => {
    const failure = new Error('storage clear unavailable');
    const storage = new MemoryStorage();
    storage.removeItem = () => { throw failure; };

    await expect(createBrowserSettingsRepository(storage).clear()).rejects.toBe(failure);
  });
});
