import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { advanceClock, installClock } from './helpers/clock';
import { seedApp } from './helpers/state';

const NOW = Date.UTC(2040, 0, 15, 9, 0, 0);

async function tabTo(page: Page, locator: Locator): Promise<void> {
  for (let count = 0; count < 50; count += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Could not reach target with keyboard navigation');
}

async function expectNoHighImpactViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

async function installGrantedNotificationRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __LOCALIZATION_AUDIO_PLAYS__: number;
      __LOCALIZATION_NOTIFICATIONS__: Array<{ title: string; body: string }>;
    };
    testWindow.__LOCALIZATION_AUDIO_PLAYS__ = 0;
    testWindow.__LOCALIZATION_NOTIFICATIONS__ = [];
    HTMLMediaElement.prototype.play = async () => {
      testWindow.__LOCALIZATION_AUDIO_PLAYS__ += 1;
    };
    class GrantedNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = async (): Promise<NotificationPermission> => 'granted';
      onclick: ((event: Event) => unknown) | null = null;

      constructor(title: string, options?: NotificationOptions) {
        testWindow.__LOCALIZATION_NOTIFICATIONS__.push({ title, body: options?.body ?? '' });
      }

      close(): void {}
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: GrantedNotification as unknown as typeof Notification,
    });
  });
}

async function saveImportedPet(page: Page): Promise<void> {
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
}

test.describe('fresh browser locale detection', () => {
  test.describe('Chinese browser', () => {
    test.use({ locale: 'zh-CN' });

    test('starts Chinese onboarding with Chinese document language', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '欢迎来到 Codex Pet Pause' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    });
  });

  test.describe('English browser', () => {
    test.use({ locale: 'en-GB' });

    test('starts English onboarding with English document language', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome to Codex Pet Pause' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
  });
});

test.describe('English browser with a persisted locale', () => {
  test.use({ locale: 'en-GB' });

  test('lets persisted zh-CN override en-GB and saves a later English override', async ({ page }) => {
    await installClock(page, NOW);
    await seedApp(page, NOW, [], { locale: 'zh-CN' });
    await page.goto('/');
    expect(await page.evaluate(() => navigator.language)).toBe('en-GB');
    await expect(page.getByRole('heading', { name: '团子 在陪你' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('radio', { name: 'English' }).check();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Language preference saved')).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: '团子 is here with you' })).toBeVisible();
  });
});

test('keeps an active countdown on the same reminder while switching language', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{
    kind: 'preset', type: 'lookAway', dueAt: NOW + 1, actionDurationSeconds: 20,
  }], { locale: 'en' });
  await page.goto('/');
  await advanceClock(page, 2);
  await page.getByRole('button', { name: 'Open reminder for 团子' }).click();
  await expect(page.getByRole('dialog', { name: 'Look into the distance reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Do it now' }).click();
  await page.getByRole('button', { name: 'Start 20-second timer' }).click();
  await expect(page.getByText('19 seconds remaining')).toBeVisible();
  const beforeSwitch = Number((await page.getByText(/seconds remaining$/).textContent())?.match(/\d+/)?.[0]);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: '中文' }).check();
  await page.getByRole('button', { name: '陪伴', exact: true }).click();
  await page.getByRole('button', { name: '团子 有一项提醒，打开' }).click();
  await expect(page.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  const remaining = page.getByText(/剩余 \d+ 秒/);
  await expect(remaining).toBeVisible();
  const afterSwitch = Number((await remaining.textContent())?.match(/\d+/)?.[0]);
  expect(afterSwitch).toBeLessThanOrEqual(beforeSwitch);
  expect(await page.evaluate(() => {
    const serialized = localStorage.getItem('neko-pause:settings');
    if (serialized === null) throw new Error('Expected persisted settings');
    const settings = JSON.parse(serialized) as { reminders: Array<{ id: string; status: string }> };
    return settings.reminders.find(({ id }) => id === 'lookAway');
  })).toMatchObject({ id: 'lookAway', status: 'due' });
});

for (const scenario of [
  {
    locale: 'zh-CN' as const,
    openPreset: 'Murk 有一项提醒，打开',
    openCustom: 'Murk 有一项提醒，打开',
    skip: '跳过',
    preset: { title: '喵', body: '该喝水了。' },
    custom: { title: '喵', body: '该服药了。' },
  },
  {
    locale: 'en' as const,
    openPreset: 'Open reminder for Murk',
    openCustom: 'Open reminder for Murk',
    skip: 'Skip',
    preset: { title: 'Meow', body: 'Time to drink water.' },
    custom: { title: 'Meow', body: 'Time to 服药.' },
  },
]) {
  test(`localizes granted notifications and keeps imported-pet audio silent in ${scenario.locale}`, async ({ page }) => {
    await installClock(page, NOW);
    await seedApp(page, NOW, [
      { kind: 'preset', type: 'drinkWater', dueAt: NOW + 60_000 },
      {
        kind: 'custom', id: 'medicine', label: '服药', enabled: true,
        intervalMinutes: 30, nextDueAt: NOW + 120_000, status: 'scheduled',
      },
    ], { locale: scenario.locale, soundEnabled: true });
    await installGrantedNotificationRecorder(page);
    await page.goto('/');
    await saveImportedPet(page);
    await page.addInitScript((now) => {
      const serialized = localStorage.getItem('neko-pause:settings');
      if (serialized === null) throw new Error('Expected persisted settings');
      const settings = JSON.parse(serialized) as {
        reminders: Array<{ id: string; nextDueAt: number }>;
      };
      localStorage.setItem('neko-pause:settings', JSON.stringify({
        ...settings,
        activePetId: 'murk',
        reminders: settings.reminders.map((reminder) => ({
          ...reminder,
          nextDueAt: reminder.id === 'drinkWater' ? now + 1 : reminder.id === 'medicine' ? now + 5_000 : reminder.nextDueAt,
        })),
      }));
    }, NOW);
    await page.reload();
    await expect(page.getByRole('button', { name: scenario.locale === 'en' ? 'Pet Murk' : '摸摸 Murk' })).toBeVisible();

    await advanceClock(page, 2);
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __LOCALIZATION_NOTIFICATIONS__: Array<{ title: string; body: string }> }
    ).__LOCALIZATION_NOTIFICATIONS__)).toEqual([scenario.preset]);
    await page.getByRole('button', { name: scenario.openPreset }).click();
    await page.getByRole('button', { name: scenario.skip }).click();

    await advanceClock(page, 5_000);
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __LOCALIZATION_NOTIFICATIONS__: Array<{ title: string; body: string }> }
    ).__LOCALIZATION_NOTIFICATIONS__)).toEqual([scenario.preset, scenario.custom]);
    await page.getByRole('button', { name: scenario.openCustom }).click();
    await expect(page.getByRole('dialog', {
      name: scenario.locale === 'en' ? '服药 reminder' : '服药提醒',
    })).toBeVisible();
    expect(await page.evaluate(() => (
      window as Window & { __LOCALIZATION_AUDIO_PLAYS__: number }
    ).__LOCALIZATION_AUDIO_PLAYS__)).toBe(0);
  });
}

test('supports English settings navigation and a reminder action with the keyboard only', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }], { locale: 'en' });
  await page.goto('/');

  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await tabTo(page, settings);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const companion = page.getByRole('button', { name: 'Companion', exact: true });
  await tabTo(page, companion);
  await page.keyboard.press('Enter');

  await advanceClock(page, 2);
  const cat = page.getByRole('button', { name: 'Open reminder for 团子' });
  await tabTo(page, cat);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Do it now' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('cat-stage')).toBeFocused();
});

for (const viewport of [
  { name: 'normal viewport', width: 1280, height: 720 },
  { name: '390px viewport', width: 390, height: 844 },
] as const) {
  for (const locale of ['zh-CN', 'en'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`keeps ${locale} import help and control in bounds and axe-clean at ${viewport.name} in ${theme} theme`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installClock(page, NOW);
        await seedApp(page, NOW, [], { locale, theme });
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.getByRole('button', { name: locale === 'en' ? 'Pet' : '宠物', exact: true }).click();

        const help = page.getByRole('button', {
          name: locale === 'en' ? 'More information about Codex pet files' : '查看 Codex 宠物文件提示',
        });
        await help.click();
        await expect(help).toHaveAttribute('aria-expanded', 'true');
        const disclosure = page.getByText(locale === 'en'
          ? /Downloaded Codex pets may already be ZIP files/
          : /下载的 Codex 宠物可能已经是 ZIP 文件/);
        await expect(disclosure).toBeVisible();
        for (const element of [help, disclosure]) {
          const bounds = await element.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        await expectNoHighImpactViolations(page);
      });
    }
  }
}
