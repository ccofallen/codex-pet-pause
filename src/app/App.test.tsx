import { render, screen } from '@testing-library/react';
import { App } from './App';
import { createAppController } from './appController';
import { AppProvider } from './AppProvider';
import { createDefaultSettings } from './defaults';
import { createFakeDependencies } from '../test/fakes';

test('shows a hydration status before controller settings are ready', () => {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('正在唤醒宠物…')).toBeVisible();
});

test('localizes the hydration status from the controller locale', () => {
  const controller = createAppController(createFakeDependencies({ now: 0, defaultLocale: 'en' }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(screen.getByText('Waking your pet…')).toBeVisible();
});

test('shows onboarding after hydration when setup is incomplete', async () => {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(await screen.findByRole('heading', { name: '欢迎来到 Codex Pet Pause' })).toBeVisible();
});

test('shows English onboarding after hydration when setup is incomplete', async () => {
  const controller = createAppController(createFakeDependencies({ now: 0, settings: null, defaultLocale: 'en' }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(await screen.findByRole('heading', { name: 'Welcome to Codex Pet Pause' })).toBeVisible();
});

test('shows application navigation after hydration when onboarding is complete', async () => {
  const settings = { ...createDefaultSettings(0), onboardingComplete: true };
  const controller = createAppController(createFakeDependencies({ now: 0, settings }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(await screen.findByRole('navigation', { name: '主要导航' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: '欢迎来到 Codex Pet Pause' })).not.toBeInTheDocument();
});

test('shows English application navigation after hydration when onboarding is complete', async () => {
  const settings = { ...createDefaultSettings(0, 'en'), onboardingComplete: true };
  const controller = createAppController(createFakeDependencies({ now: 0, settings }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
});

test('returns to onboarding when local data is cleared', async () => {
  const settings = { ...createDefaultSettings(0), onboardingComplete: true };
  const controller = createAppController(createFakeDependencies({ now: 0, settings }));
  render(<AppProvider controller={controller}><App /></AppProvider>);
  expect(await screen.findByRole('navigation', { name: '主要导航' })).toBeVisible();
  await controller.clearAll();
  expect(await screen.findByRole('heading', { name: '欢迎来到 Codex Pet Pause' })).toBeVisible();
});
