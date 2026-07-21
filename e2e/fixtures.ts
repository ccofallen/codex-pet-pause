import { expect, test as base } from '@playwright/test';

type Fixtures = { consoleGuard: void };

export const test = base.extend<Fixtures>({
  consoleGuard: [async ({ page }, use) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(`console: ${message.text()}`);
    });
    await use();
    expect(failures, 'browser console and page errors').toEqual([]);
  }, { auto: true }],
});

export { expect } from '@playwright/test';
