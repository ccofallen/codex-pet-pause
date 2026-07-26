import { expect, test } from 'vitest';
import { createDefaultSettings } from '../app/defaults';
import type { AppSettings } from '../app/model';
import type { SettingsRepository } from './settingsRepository';
import { createSynchronizedSettingsRepository } from './synchronizedSettingsRepository';

const REVISION_KEY = 'neko-pause:settings-revision';

class SerialLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

test('rebases a waiting user save onto the authority revision and persists it once as r2', async () => {
  window.localStorage.removeItem(REVISION_KEY);
  let persisted = createDefaultSettings(100);
  const locks = new SerialLockManager();
  let authoritySaveStarted!: () => void;
  let finishAuthoritySave!: () => void;
  const authorityStarted = new Promise<void>((resolve) => { authoritySaveStarted = resolve; });
  const authorityBase: SettingsRepository = {
    load: async () => persisted,
    save: async (settings: AppSettings) => {
      persisted = settings;
      authoritySaveStarted();
      await new Promise<void>((resolve) => { finishAuthoritySave = resolve; });
    },
    clear: async () => { persisted = createDefaultSettings(100); },
  };
  let userSaveCount = 0;
  const userBase: SettingsRepository = {
    load: async () => persisted,
    save: async (settings: AppSettings) => {
      userSaveCount += 1;
      persisted = settings;
    },
    clear: async () => { persisted = createDefaultSettings(100); },
  };
  const authority = createSynchronizedSettingsRepository(
    authorityBase,
    window.localStorage,
    { conflictPolicy: 'reject', locks },
  );
  const settingsRenderer = createSynchronizedSettingsRepository(
    userBase,
    window.localStorage,
    { conflictPolicy: 'replay-user-operation', locks },
  );
  const r0 = (await authority.load())!;
  const userBaseRevision = (await settingsRenderer.load())!;
  const authorityWrite = authority.save({ ...r0, affinity: 55 });
  await authorityStarted;
  let userSettled = false;
  const userWrite = settingsRenderer
    .save({ ...userBaseRevision, theme: 'dark' })
    .then(() => { userSettled = true; });

  await Promise.resolve();
  expect(userSettled).toBe(false);
  finishAuthoritySave();
  await Promise.all([authorityWrite, userWrite]);

  expect(persisted).toMatchObject({
    affinity: 55,
    theme: 'dark',
  });
  expect(userSaveCount).toBe(1);
  expect(window.localStorage.getItem(REVISION_KEY)).not.toBeNull();
  window.localStorage.removeItem(REVISION_KEY);
});

test('attempts one conflict replay and propagates its failure without looping', async () => {
  window.localStorage.removeItem(REVISION_KEY);
  let persisted = createDefaultSettings(100);
  const locks = new SerialLockManager();
  const authority = createSynchronizedSettingsRepository({
    load: async () => persisted,
    save: async (settings) => { persisted = settings; },
    clear: async () => undefined,
  }, window.localStorage, { conflictPolicy: 'reject', locks });
  let replayAttempts = 0;
  const settingsRenderer = createSynchronizedSettingsRepository({
    load: async () => persisted,
    save: async () => {
      replayAttempts += 1;
      throw new Error('replay write failed');
    },
    clear: async () => undefined,
  }, window.localStorage, { conflictPolicy: 'replay-user-operation', locks });
  const r0 = (await authority.load())!;
  const userBase = (await settingsRenderer.load())!;
  await authority.save({ ...r0, affinity: 55 });

  await expect(settingsRenderer.save({ ...userBase, theme: 'dark' }))
    .rejects.toThrow('replay write failed');
  expect(replayAttempts).toBe(1);
  expect(persisted).toMatchObject({ affinity: 55, theme: r0.theme });
  window.localStorage.removeItem(REVISION_KEY);
});

test('does not retry an arbitrary repository write error', async () => {
  window.localStorage.removeItem(REVISION_KEY);
  let saveAttempts = 0;
  const repository = createSynchronizedSettingsRepository({
    load: async () => createDefaultSettings(100),
    save: async () => {
      saveAttempts += 1;
      throw new Error('disk unavailable');
    },
    clear: async () => undefined,
  }, window.localStorage, {
    conflictPolicy: 'replay-user-operation',
    locks: new SerialLockManager(),
  });
  await repository.load();

  await expect(repository.save(createDefaultSettings(100))).rejects.toThrow('disk unavailable');
  expect(saveAttempts).toBe(1);
  window.localStorage.removeItem(REVISION_KEY);
});

test('replays a stale clear once so the newer user intent still wins', async () => {
  window.localStorage.removeItem(REVISION_KEY);
  let persisted: AppSettings | null = createDefaultSettings(100);
  const locks = new SerialLockManager();
  const base = (): SettingsRepository => ({
    load: async () => persisted,
    save: async (settings) => { persisted = settings; },
    clear: async () => { persisted = null; },
  });
  const authority = createSynchronizedSettingsRepository(base(), window.localStorage, {
    conflictPolicy: 'reject',
    locks,
  });
  const settingsRenderer = createSynchronizedSettingsRepository(base(), window.localStorage, {
    conflictPolicy: 'replay-user-operation',
    locks,
  });
  const r0 = (await authority.load())!;
  await settingsRenderer.load();
  await authority.save({ ...r0, affinity: 55 });

  await settingsRenderer.clear();

  expect(persisted).toBeNull();
  window.localStorage.removeItem(REVISION_KEY);
});
