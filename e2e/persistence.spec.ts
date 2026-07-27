import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { openWaitingCat } from './helpers/cat';
import { advanceClock, installClock } from './helpers/clock';
import { seedApp } from './helpers/state';

const NOW = Date.UTC(2040, 0, 15, 9, 0, 0);

interface PersistedSettings {
  cat: {
    name: string;
  };
  reminders: Array<{
    id: string;
    kind: 'preset' | 'custom';
    type?: string;
    label?: string;
    enabled: boolean;
    intervalMinutes: number;
    nextDueAt: number;
    status: string;
  }>;
}

async function readPersistedSettings(page: Page): Promise<PersistedSettings> {
  return page.evaluate(() => {
    const serialized = localStorage.getItem('neko-pause:settings');
    if (serialized === null) throw new Error('Expected persisted settings');
    return JSON.parse(serialized) as PersistedSettings;
  });
}

test('persists settings and IndexedDB history across reload', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.goto('/');
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await page.getByRole('button', { name: '现在做' }).click();
  await page.getByRole('button', { name: '完成了' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('neko-pause');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('activity', 'readonly');
    const count = transaction.objectStore('activity').count();
    return new Promise<number>((resolve, reject) => {
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  })).toBe(1);

  const expectedNextDueAt = NOW + 2 + 45 * 60_000;
  const beforeReload = await readPersistedSettings(page);
  expect(beforeReload.cat).toEqual({ name: '团子' });
  expect(beforeReload.reminders.find(({ type }) => type === 'drinkWater')).toMatchObject({
    enabled: true,
    intervalMinutes: 45,
    nextDueAt: expectedNextDueAt,
  });

  await page.reload();
  await expect(page.getByText('亲密度 1 · 初识')).toBeVisible();
  const afterReload = await readPersistedSettings(page);
  expect(afterReload).toEqual(beforeReload);

  await page.getByRole('button', { name: '宠物', exact: true }).click();
  await expect(page.getByRole('article', { name: '团子（当前）' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);

  await page.getByRole('button', { name: '提醒', exact: true }).click();
  await expect(page.getByLabel('启用喝水提醒')).toBeChecked();
  await expect(page.getByLabel('喝水间隔（分钟）')).toHaveValue('45');
  expect((await readPersistedSettings(page)).reminders.find(({ type }) => type === 'drinkWater')?.nextDueAt)
    .toBe(expectedNextDueAt);
});

test('persists and repeats a one-minute custom reminder without a second reload', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await installClock(page, NOW);
  await seedApp(page, NOW, []);
  await page.goto('/');

  await page.getByRole('button', { name: '提醒', exact: true }).click();
  await page.getByRole('button', { name: '添加提醒' }).click();
  await page.getByLabel('事项名称').fill('吃药');
  await page.getByLabel('循环间隔（分钟）').fill('1');
  await page.getByLabel('立即启用').check();
  await page.getByRole('button', { name: '保存自定义提醒' }).click();

  const beforeReload = await readPersistedSettings(page);
  const created = beforeReload.reminders.find(({ kind }) => kind === 'custom');
  expect(created).toMatchObject({
    id: expect.stringMatching(/^custom-/),
    kind: 'custom',
    label: '吃药',
    enabled: true,
    intervalMinutes: 1,
    nextDueAt: expect.any(Number),
    status: 'scheduled',
  });

  await page.reload();
  await page.getByRole('button', { name: '提醒', exact: true }).click();
  await expect(page.getByRole('group', { name: '吃药' })).toBeVisible();
  const afterReload = await readPersistedSettings(page);
  expect(afterReload.reminders.find(({ kind }) => kind === 'custom')).toEqual(created);

  await page.getByRole('button', { name: '陪伴', exact: true }).click();
  const companion = page.getByRole('region', { name: '团子 在陪你' });
  await expect(companion.getByRole('heading', { name: '吃药' })).toBeVisible();
  await expect(companion.getByText('1 分钟', { exact: true })).toBeVisible();
  if (created === undefined) throw new Error('Expected custom reminder');
  expect(created.nextDueAt).toBeGreaterThanOrEqual(NOW + 60_000);
  expect(created.nextDueAt).toBeLessThan(NOW + 61_000);
  await advanceClock(page, created.nextDueAt - NOW);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '吃药提醒' })).toBeVisible();
  await page.getByRole('button', { name: '跳过' }).click();

  const afterSkip = await readPersistedSettings(page);
  expect(afterSkip.reminders.find(({ id }) => id === created?.id)).toMatchObject({
    id: created?.id,
    label: '吃药',
    nextDueAt: created.nextDueAt + 60_000,
    status: 'scheduled',
  });
  await advanceClock(page, 60_000);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '吃药提醒' })).toBeVisible();
});

test('atomically persists legacy pet metadata in real browser IndexedDB', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 192 * 8;
    canvas.height = 208 * 9;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Expected canvas context');
    context.fillStyle = '#000';
    context.fillRect(0, 0, 1, 1);
    const spritesheet = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('Could not encode atlas'));
        else resolve(blob);
      }, 'image/webp');
    });
    const request = indexedDB.open('codex-pet-pause-pets', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pets')) {
        request.result.createObjectStore('pets', { keyPath: 'id' });
      }
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('pets', 'readwrite');
    transaction.objectStore('pets').put({
      id: 'legacy-browser-pet',
      displayName: 'Legacy Browser Pet',
      spriteVersion: 1,
      spritesheetFilename: 'spritesheet.webp',
      spritesheet,
      importedAt: 100,
      updatedAt: 100,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('codex-pet-pause-pets', 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('pets', 'readonly');
    const get = transaction.objectStore('pets').get('legacy-browser-pet');
    const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return {
      hasMetadata: record?.frameMetadata !== undefined,
      hasRevision: typeof record?.atlasRevision === 'string',
    };
  })).toEqual({ hasMetadata: true, hasRevision: true });

  await page.reload();
  await expect(await page.evaluate(async () => {
    const request = indexedDB.open('codex-pet-pause-pets', 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('pets', 'readonly');
    const get = transaction.objectStore('pets').get('legacy-browser-pet');
    const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return {
      hasMetadata: record?.frameMetadata !== undefined,
      hasRevision: typeof record?.atlasRevision === 'string',
    };
  })).toEqual({ hasMetadata: true, hasRevision: true });
});

test('delivers an imported-pet reminder without webpage cat audio', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{
    kind: 'preset', type: 'drinkWater', dueAt: NOW + 60_000,
  }], { soundEnabled: true });
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __NEKO_TEST_AUDIO_PLAY_COUNT__: number;
      __NEKO_TEST_NOTIFICATIONS__: Array<{ title: string; body?: string; tag?: string }>;
    };
    testWindow.__NEKO_TEST_AUDIO_PLAY_COUNT__ = 0;
    testWindow.__NEKO_TEST_NOTIFICATIONS__ = [];
    HTMLMediaElement.prototype.play = async function play() {
      testWindow.__NEKO_TEST_AUDIO_PLAY_COUNT__ += 1;
    };
    class TestNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = async (): Promise<NotificationPermission> => 'granted';
      onclick: ((event: Event) => unknown) | null = null;

      constructor(title: string, options?: NotificationOptions) {
        testWindow.__NEKO_TEST_NOTIFICATIONS__.push({
          title,
          ...(options?.body === undefined ? {} : { body: options.body }),
          ...(options?.tag === undefined ? {} : { tag: options.tag }),
        });
      }

      close(): void {}
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: TestNotification as unknown as typeof Notification,
    });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('codex-pet-pause-pets', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('pets')) {
        request.result.createObjectStore('pets', { keyPath: 'id' });
      }
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('pets', 'readwrite');
    transaction.objectStore('pets').put({
      id: 'murk',
      displayName: 'Murk',
      description: 'Moon ghost',
      spriteVersion: 2,
      spritesheetFilename: 'spritesheet.webp',
      spritesheet: new Blob(['test-webp'], { type: 'image/webp' }),
      importedAt: 100,
      updatedAt: 100,
      frameMetadata: {
        animationColumns: Object.fromEntries([
          'idle', 'running-right', 'running-left', 'waving', 'jumping',
          'failed', 'waiting', 'running', 'review',
        ].map((animation) => [animation, [0]])),
        visibleLookDirections: [0],
      },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

  });
  await page.addInitScript((dueAt) => {
    const serialized = localStorage.getItem('neko-pause:settings');
    if (serialized === null) return;
    const settings = JSON.parse(serialized) as { reminders: Array<{ id: string; nextDueAt: number }> };
    localStorage.setItem('neko-pause:settings', JSON.stringify({
      ...settings,
      activePetId: 'murk',
      reminders: settings.reminders.map((reminder) => (
        reminder.id === 'drinkWater' ? { ...reminder, nextDueAt: dueAt } : reminder
      )),
    }));
  }, NOW + 1);

  await page.reload();
  const importedState = await page.evaluate(async () => {
    const serialized = localStorage.getItem('neko-pause:settings');
    if (serialized === null) throw new Error('Expected persisted settings');
    const request = indexedDB.open('codex-pet-pause-pets', 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('pets', 'readonly');
    const get = transaction.objectStore('pets').get('murk');
    const pet = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      get.onerror = () => reject(get.error);
    });
    database.close();
    const settings = JSON.parse(serialized) as { activePetId: string; soundEnabled: boolean };
    return {
      activePetId: settings.activePetId,
      soundEnabled: settings.soundEnabled,
      notificationPermission: Notification.permission,
      hasMurk: pet !== undefined,
      spritesheetIsBlob: pet?.spritesheet instanceof Blob,
    };
  });
  expect(importedState).toEqual({
    activePetId: 'murk',
    soundEnabled: true,
    notificationPermission: 'granted',
    hasMurk: true,
    spritesheetIsBlob: true,
  });
  await expect(page.getByRole('button', { name: '摸摸 Murk' })).toBeVisible();
  await advanceClock(page, 2);
  await expect.poll(() => page.evaluate(() => (
    window as Window & {
      __NEKO_TEST_NOTIFICATIONS__?: Array<{ title: string; body?: string; tag?: string }>;
    }
  ).__NEKO_TEST_NOTIFICATIONS__)).toEqual([
    { title: '喵', body: '该喝水了。', tag: 'neko-pause-reminder' },
  ]);
  await openWaitingCat(page, 'Murk');
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __NEKO_TEST_AUDIO_PLAY_COUNT__: number }
  ).__NEKO_TEST_AUDIO_PLAY_COUNT__)).toBe(0);
});

test('clears local settings and IndexedDB history after confirmation', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.goto('/');
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await page.getByRole('button', { name: '现在做' }).click();
  await page.getByRole('button', { name: '完成了' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '清除全部本地数据' }).click();
  await page.getByLabel('我了解本机数据将被删除').check();
  await page.getByRole('button', { name: '删除并重新开始' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Codex Pet Pause' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('neko-pause:settings'))).toBeNull();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('neko-pause');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('activity', 'readonly');
    const count = transaction.objectStore('activity').count();
    return new Promise<number>((resolve, reject) => {
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  })).toBe(0);
});

test('degrades to a temporary session when local storage is unavailable', async ({ page }) => {
  await installClock(page, NOW);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.goto('/');
  await expect(page.getByText('Waking your pet…')).toHaveCount(0);
  await page.getByLabel('Cat name').fill('临时猫');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Enable Drink water reminder').check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Review your settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Start companion' }).click();
  await expect(page.getByText('This is a temporary session. Settings may be lost after refreshing.')).toBeVisible();
});

test('shows denied notification guidance without blocking in-page reminders', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
  });
  await page.goto('/');
  await expect(page.getByText('系统通知已关闭，后台提醒可靠性会降低')).toBeVisible();
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});

test('reloads the cached application while offline after an online visit', async ({ page, context }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, []);
  await page.goto('/');
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '团子 在陪你' })).toBeVisible();
  await expect(page.getByRole('button', { name: '摸摸 团子' })).toBeVisible();
  await expect(page.getByTestId('cat-atlas-loader')).toHaveJSProperty('complete', true);
  await expect(page.getByTestId('cat-sprite')).toHaveAttribute('data-atlas-status', 'loaded');
  await expect(page.locator('.cat-sprite-fallback')).toHaveCount(0);
  await expect(page.getByTestId('cat-sprite')).toHaveCSS('background-image', /neko-pause-cat\.webp/);
  expect(await page.evaluate(async () => (await fetch('/assets/cat/meow.wav')).status)).toBe(200);
  await context.setOffline(false);
});
