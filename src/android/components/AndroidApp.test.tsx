import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { AppProvider } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { AndroidApp } from './AndroidApp';
import { I18nProvider } from '../../i18n/I18nProvider';
import { createFakeDependencies } from '../../test/fakes';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidCapabilities, AndroidControlHost } from '../bridge/androidHost';

function renderAndroidApp(locale: 'zh-CN' | 'en' = 'zh-CN') {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  return render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><AndroidApp /></I18nProvider>
    </AppProvider>,
  );
}

function deniedControlHost(): AndroidControlHost {
  const capabilities: AndroidCapabilities = {
    apiLevel: 35,
    overlayPermission: 'denied',
    notificationPermission: 'deniedCanAsk',
    serviceActive: false,
    petVisible: false,
  };
  return {
    loadSnapshot: async () => null,
    clearSettings: async () => undefined,
    replaceHistory: async () => undefined,
    clearHistory: async () => undefined,
    clearPets: async () => undefined,
    saveSettings: async () => undefined,
    appendHistory: async () => undefined,
    savePet: async () => undefined,
    deletePet: async () => undefined,
    selectPet: async () => undefined,
    subscribe: () => () => undefined,
    getCapabilities: async () => capabilities,
    requestNotifications: async () => capabilities,
    openNotificationSettings: async () => capabilities,
    openOverlaySettings: async () => capabilities,
    startService: async () => capabilities,
    showPet: async () => capabilities,
    hidePet: async () => capabilities,
    quit: async () => capabilities,
    subscribeCapabilities: () => () => undefined,
  };
}

test('keeps the save and Petdex actions in the mobile thumb action region', async () => {
  renderAndroidApp();

  const actions = await screen.findByTestId('android-thumb-actions');
  expect(within(actions).getByRole('button', { name: '保存设置' })).toBeVisible();
  expect(within(actions).getByRole('button', { name: '浏览 Petdex 并自动导入' })).toBeVisible();
});

test('does not render an embedded second pet in Android settings', async () => {
  renderAndroidApp();

  await screen.findByRole('button', { name: '保存应用设置' });

  expect(screen.queryByTestId('interactive-cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('cat-stage')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pet-stage')).not.toBeInTheDocument();
});

test('localizes Android navigation and capability status in English', async () => {
  renderAndroidApp('en');

  expect(await screen.findByRole('navigation', { name: 'Phone navigation' })).toBeVisible();
  expect(screen.getByText('Settings and pets are stored securely on this phone.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Browse Petdex and import automatically' })).toBeVisible();
});

test('keeps settings navigation and retry available when overlay permission is refused', async () => {
  const controller = createAppController(createFakeDependencies({ now: 0 }));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp host={deniedControlHost()} /></I18nProvider>
    </AppProvider>,
  );

  expect(await screen.findByRole('navigation', { name: '手机导航' })).toBeVisible();
  expect(screen.getByRole('button', { name: '重新授权' })).toBeVisible();
});

test('waits for native hydration before mounting settings drafts', async () => {
  const persisted = createDefaultSettings(0);
  persisted.theme = 'dark';
  const dependencies = createFakeDependencies({ now: 0 });
  let resolveLoad!: (settings: typeof persisted) => void;
  dependencies.settings.load = () => new Promise<typeof persisted>((resolve) => { resolveLoad = resolve; });
  const controller = createAppController(dependencies);

  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp /></I18nProvider>
    </AppProvider>,
  );

  expect(screen.getByTestId('android-loading')).toBeVisible();
  expect(screen.queryByRole('button', { name: '保存应用设置' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('android-thumb-actions')).not.toBeInTheDocument();

  await act(async () => { resolveLoad(persisted); });

  expect(await screen.findByRole('button', { name: '保存应用设置' })).toBeVisible();
  expect(screen.getByLabelText('夜间')).toBeChecked();
  expect(dependencies.settings.saves).not.toHaveLength(0);
  expect(dependencies.settings.saves.every((settings) => settings.theme === 'dark')).toBe(true);
});

test('submits the visible Android settings form from the thumb action region', async () => {
  const user = userEvent.setup();
  const dependencies = createFakeDependencies({ now: 0 });
  const controller = createAppController(dependencies);
  const saveSettings = vi.spyOn(controller, 'saveSettings');
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN"><AndroidApp /></I18nProvider>
    </AppProvider>,
  );

  await screen.findByRole('button', { name: '保存应用设置' });
  await user.click(screen.getByLabelText('夜间'));
  const action = within(screen.getByTestId('android-thumb-actions'))
    .getByRole('button', { name: '保存设置' });
  expect(action).toHaveAttribute('type', 'submit');
  expect(action).toHaveAttribute('form', 'android-settings-form');
  await user.click(action);

  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' })));
});

test('hides the save action when the active Android view has no settings form', async () => {
  const user = userEvent.setup();
  renderAndroidApp();

  await screen.findByRole('button', { name: '保存应用设置' });
  await user.click(screen.getByRole('button', { name: '宠物' }));

  expect(within(screen.getByTestId('android-thumb-actions'))
    .queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
});

test('reserves the complete fixed Android action region without a magic-height shortcut', () => {
  const styles = readFileSync('src/styles/android.css', 'utf8');

  expect(styles).toContain('--android-fixed-region-reserve');
  expect(styles).toContain('var(--android-fixed-region-reserve)');
  expect(styles).toContain('--android-thumb-status-height');
  expect(styles).not.toContain('5.75rem');
});
