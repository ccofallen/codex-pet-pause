import { expect, type Page } from '@playwright/test';

export async function openWaitingCat(page: Page, catName = '团子'): Promise<void> {
  const cat = page.getByRole('button', { name: `${catName} 有一项提醒，打开` });
  await expect(cat).toBeVisible();
  await cat.click();
}
