import { expect, test } from './fixtures';
import { installClock } from './helpers/clock';

const NOW = Date.UTC(2040, 0, 15, 9, 0, 0);

test.use({ locale: 'zh-CN' });

test('completes onboarding and persists the cat, reminder, and theme', async ({ page }) => {
  await installClock(page, NOW);
  await page.goto('/');
  await expect(page.getByRole('img', { name: '猫咪预览' })).toBeVisible();
  await page.getByLabel('猫咪名字').fill('团子');
  await expect(page.getByRole('radio', { name: '姜黄色' })).toHaveCount(0);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('启用喝水提醒').check();
  await page.getByLabel('喝水间隔（分钟）').fill('45');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('radio', { name: '夜间' }).check();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '确认你的设置' })).toBeVisible();
  await page.getByRole('button', { name: '开始陪伴' }).click();

  await expect(page.getByRole('heading', { name: '团子 在陪你' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: '团子 在陪你' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('已启用 1 种提醒')).toBeVisible();
});
