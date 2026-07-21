import { expect, test } from './fixtures';
import { openWaitingCat } from './helpers/cat';
import { advanceClock, installClock } from './helpers/clock';
import { seedApp } from './helpers/state';

const NOW = Date.UTC(2040, 0, 15, 9, 0, 0);

test('eats on the deterministic deadline and gives dragging visual priority', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await seedApp(page, NOW, []);
  await page.goto('/');

  const stage = page.getByTestId('cat-stage');
  const sprite = page.getByTestId('cat-sprite');
  await page.clock.fastForward(120_000);
  await expect(stage).toHaveAttribute('data-mode', 'eating');
  await expect(sprite).toHaveAttribute('data-row', '3');

  const bounds = await stage.boundingBox();
  if (bounds === null) throw new Error('Expected cat bounds');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y);
  await expect(stage).toHaveAttribute('data-mode', 'dragging');
  await expect(sprite).toHaveAttribute('data-row', '5');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-mode', 'reacting');
  await expect(stage).toHaveAttribute('data-reaction', 'dropped');
  await expect(sprite).toHaveAttribute('data-row', '0');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('opens the next skipped cycle without safety, refresh, focus, or visibility recovery', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      return timeout === 30_000
        ? nativeSetInterval(() => undefined, timeout)
        : nativeSetInterval(handler, timeout, ...args);
    }) as typeof window.setInterval;
  });
  await seedApp(page, NOW, [{
    kind: 'preset',
    type: 'lookAway',
    dueAt: NOW + 1,
    intervalMinutes: 1,
  }]);
  await page.goto('/');
  await page.clock.fastForward(10);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();

  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(60_000);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
});

test('recovers an overdue reminder from the injected absolute clock', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 60_000, intervalMinutes: 1 }]);
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advanceClock(page, 60_001);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});

test('supports complete, snooze with 10-minute focus, and skip', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [
    { kind: 'preset', type: 'lookAway', dueAt: NOW + 1, intervalMinutes: 20 },
    { kind: 'preset', type: 'drinkWater', dueAt: NOW + 2, intervalMinutes: 45 },
    { kind: 'preset', type: 'standUp', dueAt: NOW + 3, intervalMinutes: 60 },
  ]);
  await page.goto('/');
  await advanceClock(page, 10);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  await page.getByRole('button', { name: '现在做' }).click();
  await page.getByRole('button', { name: '完成了' }).click();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: '目视远方已完成' })).toBeVisible();
  await page.getByRole('button', { name: '继续下一项' }).click();

  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
  await page.getByRole('button', { name: '稍后提醒' }).click();
  await expect(page.getByRole('button', { name: '10 分钟' })).toBeFocused();
  await page.getByRole('button', { name: '10 分钟' }).click();

  await expect(page.getByRole('dialog', { name: '起身活动提醒' })).toBeVisible();
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('亲密度 1 · 初识')).toBeVisible();

  await advanceClock(page, 10 * 60_000);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});

test('keeps simultaneous reminders ordered and continues one at a time', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [
    { kind: 'preset', type: 'drinkWater', dueAt: NOW + 2 },
    { kind: 'preset', type: 'lookAway', dueAt: NOW + 1 },
  ]);
  await page.goto('/');
  await advanceClock(page, 10);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});

test('shows and handles a due reminder globally while settings are open', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
  await page.getByRole('button', { name: '跳过' }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
});

test('shifts due time across a manual pause', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 60_000, intervalMinutes: 1 }]);
  await page.goto('/');
  await page.getByRole('button', { name: '提醒', exact: true }).click();
  await page.getByRole('button', { name: '暂停 30 分钟' }).click();
  await expect(page.getByRole('button', { name: '立即恢复' })).toBeVisible();
  await advanceClock(page, 30 * 60_000);
  await page.getByRole('button', { name: '陪伴', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advanceClock(page, 60_001);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});

test('shifts due time while quiet hours are active', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 60_000, intervalMinutes: 1 }]);
  await page.goto('/');
  await page.getByRole('button', { name: '提醒', exact: true }).click();
  await page.getByLabel('启用静默时段').check();
  await page.getByLabel('静默开始时间').fill('09:00');
  await page.getByLabel('静默结束时间').fill('10:00');
  await page.getByRole('button', { name: '保存提醒设置' }).click();
  await expect(page.getByText('提醒设置已保存')).toBeVisible();
  await advanceClock(page, 60 * 60_000);
  await page.getByRole('button', { name: '陪伴', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advanceClock(page, 60_001);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
});
