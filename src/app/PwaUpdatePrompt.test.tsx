import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { createPwaStatusStore } from '../infrastructure/pwaStatus';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

test('offers a non-blocking update and lets the user postpone it', async () => {
  const user = userEvent.setup();
  const store = createPwaStatusStore();
  render(<I18nProvider locale="en"><PwaUpdatePrompt store={store} /></I18nProvider>);

  store.markUpdateAvailable();
  expect(await screen.findByRole('status')).toHaveTextContent('A new version is available');
  await user.click(screen.getByRole('button', { name: 'Later' }));
  expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
});

test('protects update submission and leaves a failed update actionable', async () => {
  const user = userEvent.setup();
  const store = createPwaStatusStore();
  let reject!: (error: Error) => void;
  const update = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
  store.connectUpdate(update);
  store.markUpdateAvailable();
  render(<I18nProvider locale="en"><PwaUpdatePrompt store={store} /></I18nProvider>);

  const updateButton = screen.getByRole('button', { name: 'Update' });
  await user.click(updateButton);
  expect(updateButton).toBeDisabled();
  await user.click(updateButton);
  expect(update).toHaveBeenCalledOnce();

  reject(new Error('failed'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Update failed. Please try again later.');
  expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
});

test('shows only update errors and ignores registration failures', async () => {
  const store = createPwaStatusStore();
  store.markUpdateAvailable();
  store.markRegistrationError();
  const rendered = render(<I18nProvider locale="en"><PwaUpdatePrompt store={store} /></I18nProvider>);

  expect(await screen.findByRole('status')).toHaveTextContent('A new version is available');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rendered.rerender(<I18nProvider locale="zh-CN"><PwaUpdatePrompt store={store} /></I18nProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('有新版本可用');
});
