import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../app/defaults';
import { createRendererSettingsRepository } from './rendererSettingsRepository';
import { SETTINGS_KEY } from './settingsRepository';
import type { LockManagerLike } from './synchronizedSettingsRepository';

class DeferredLockManager implements LockManagerLike {
  requests = 0;

  request<T>(_name: string, _callback: () => Promise<T> | T): Promise<T> {
    this.requests += 1;
    return new Promise<T>(() => undefined);
  }
}

class ImmediateLockManager implements LockManagerLike {
  requests = 0;

  async request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    this.requests += 1;
    return callback();
  }
}

describe('createRendererSettingsRepository', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists ordinary web settings immediately without waiting for a Web Lock', async () => {
    const locks = new DeferredLockManager();
    const repository = createRendererSettingsRepository({
      storage: window.localStorage,
      defaultLocale: 'en',
      desktopShellAvailable: false,
      lifecycle: 'authoritative',
      locks,
    });
    const settings = createDefaultSettings(1_000);
    settings.theme = 'dark';

    const saving = repository.save(settings);

    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null')).toMatchObject({
      theme: 'dark',
    });
    expect(locks.requests).toBe(0);
    await saving;
  });

  it.each(['authoritative', 'passive'] as const)(
    'keeps Electron %s settings behind the synchronization lock',
    async (lifecycle) => {
      const locks = new ImmediateLockManager();
      const repository = createRendererSettingsRepository({
        storage: window.localStorage,
        defaultLocale: 'en',
        desktopShellAvailable: true,
        lifecycle,
        locks,
      });

      await repository.save(createDefaultSettings(1_000));

      expect(locks.requests).toBe(1);
    },
  );
});
