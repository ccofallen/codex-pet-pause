import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openWaitingCat } from './helpers/cat';
import { advanceClock, installClock } from './helpers/clock';
import { seedApp } from './helpers/state';

const NOW = Date.UTC(2040, 0, 15, 9, 0, 0);

async function expectNoHighImpactViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

async function tabTo(page: Page, locator: ReturnType<Page['getByRole']>): Promise<void> {
  for (let count = 0; count < 40; count += 1) {
    if (await locator.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Could not reach target with keyboard navigation');
}

async function readCatTranslation(page: Page): Promise<{ x: number; y: number }> {
  return page.getByTestId('cat-stage').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
}

async function beginCatDrag(page: Page): Promise<void> {
  const cat = page.getByTestId('cat-stage');
  const bounds = await cat.boundingBox();
  if (bounds === null) throw new Error('Expected cat bounds');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y);
  await expect(cat).toHaveAttribute('data-mode', 'dragging');
}

test('has no serious or critical axe violations during onboarding', async ({ page }) => {
  await installClock(page, NOW);
  await page.goto('/');
  await expectNoHighImpactViolations(page);
});

test('has no serious or critical axe violations on configured app surfaces', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.goto('/');
  await beginCatDrag(page);
  await expectNoHighImpactViolations(page);
  await page.mouse.up();
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNoHighImpactViolations(page);
  await openWaitingCat(page);
  await expect(page.getByRole('dialog', { name: '喝水提醒' })).toBeVisible();
  await expectNoHighImpactViolations(page);
  await page.getByRole('button', { name: '跳过' }).click();

  await page.getByRole('button', { name: '宠物', exact: true }).click();
  await expectNoHighImpactViolations(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expectNoHighImpactViolations(page);
});

test('completes a reminder and reaches all four views with keyboard only', async ({ page }) => {
  await installClock(page, NOW);
  await seedApp(page, NOW, [{ kind: 'preset', type: 'drinkWater', dueAt: NOW + 1 }]);
  await page.goto('/');
  await advanceClock(page, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cat = page.getByRole('button', { name: '团子 有一项提醒，打开' });
  await tabTo(page, cat);
  await expect(cat).toBeFocused();

  const initial = await readCatTranslation(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => readCatTranslation(page)).toEqual({ x: initial.x - 20, y: initial.y });
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => readCatTranslation(page)).toEqual({ x: initial.x - 100, y: initial.y });
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => readCatTranslation(page)).toEqual({
    x: initial.x - 100,
    y: Math.max(0, initial.y - 80),
  });
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => readCatTranslation(page)).toEqual({ x: initial.x - 100, y: 0 });
  const clampedBounds = await cat.boundingBox();
  expect(clampedBounds).not.toBeNull();
  expect(clampedBounds!.x).toBeGreaterThanOrEqual(0);
  expect(clampedBounds!.y).toBe(0);
  expect(clampedBounds!.x + clampedBounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(clampedBounds!.y + clampedBounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));

  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '现在做' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '完成了' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('喝水已完成')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  for (const [buttonName, headingName] of [
    ['提醒', '提醒'], ['宠物', '宠物库'], ['设置', '设置'], ['陪伴', '团子 在陪你'],
  ] as const) {
    const button = page.getByRole('button', { name: buttonName, exact: true });
    await tabTo(page, button);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: headingName, exact: true })).toBeVisible();
  }
});

test('removes CatStage transitions when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await seedApp(page, NOW, []);
  await page.goto('/');
  const stage = page.getByTestId('cat-stage');
  await expect(stage).toBeVisible();
  await stage.evaluate((element) => {
    const modes = [element.getAttribute('data-mode') ?? ''];
    element.setAttribute('data-test-mode-history', modes.join(','));
    new MutationObserver(() => {
      modes.push(element.getAttribute('data-mode') ?? '');
      element.setAttribute('data-test-mode-history', modes.join(','));
    }).observe(element, { attributes: true, attributeFilter: ['data-mode'] });
  });
  await page.clock.fastForward(2 * 60_000);
  await expect(stage).not.toHaveAttribute('data-mode', 'eating');
  await page.clock.fastForward(3 * 60_000);
  await expect(stage).not.toHaveAttribute('data-mode', 'eating');
  await expect(stage).not.toHaveAttribute('data-test-mode-history', /(?:^|,)eating(?:,|$)/);
  await expectNoHighImpactViolations(page);
  await expect(stage).toHaveCSS('transition-property', 'none');
});

for (const theme of ['light', 'dark'] as const) {
  test(`keeps import help ordered and axe-clean in the ${theme} theme`, async ({ page }) => {
    await installClock(page, NOW);
    await seedApp(page, NOW, [], { theme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: '宠物', exact: true }).click();

    const description = page.getByText(/确认预览后才会保存到这台设备/);
    const help = description.getByRole('button', { name: '查看 Codex 宠物文件提示' });
    await expect(help).toBeVisible();
    expect(await description.evaluate((element) => {
      const button = element.querySelector('button');
      if (button === null) return false;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEndBefore(button);
      return range.toString().includes('确认预览后才会保存到这台设备。');
    })).toBe(true);

    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/Codex 宠物文件通常位于/)).toBeVisible();
    await expectNoHighImpactViolations(page);
  });
}

test('keeps expanded import help unclipped and axe-clean at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installClock(page, NOW);
  await seedApp(page, NOW, [], { theme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: '宠物', exact: true }).click();

  const description = page.getByText(/确认预览后才会保存到这台设备/);
  const help = description.getByRole('button', { name: '查看 Codex 宠物文件提示' });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');

  const disclosure = page.getByText(/Codex 宠物文件通常位于/);
  await expect(disclosure).toBeVisible();
  const descriptionBounds = await description.boundingBox();
  const disclosureBounds = await disclosure.boundingBox();
  expect(descriptionBounds).not.toBeNull();
  expect(disclosureBounds).not.toBeNull();
  for (const bounds of [descriptionBounds!, disclosureBounds!]) {
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expectNoHighImpactViolations(page);
});
