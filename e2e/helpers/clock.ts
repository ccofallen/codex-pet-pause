import type { Page } from '@playwright/test';

export async function installClock(page: Page, initialNow: number): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(window, '__NEKO_TEST_NOW__', { value, writable: true });
  }, initialNow);
}

export async function advanceClock(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((delta) => {
    window.__NEKO_TEST_NOW__ = (window.__NEKO_TEST_NOW__ ?? Date.now()) + delta;
    window.dispatchEvent(new Event('focus'));
  }, milliseconds);
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null);
}
