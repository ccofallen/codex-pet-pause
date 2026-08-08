import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import type {
  AndroidCapabilities,
  AndroidCapabilitiesEvent,
  AndroidControlHost,
} from '../bridge/androidHost';
import { AndroidOnboarding } from './AndroidOnboarding';

const api28Denied: AndroidCapabilities = {
  apiLevel: 28,
  overlayPermission: 'denied',
  notificationPermission: 'notRequired',
  notificationRequestAttempted: true,
  serviceActive: false,
  petVisible: false,
};

const api35Denied: AndroidCapabilities = {
  apiLevel: 35,
  overlayPermission: 'denied',
  notificationPermission: 'denied',
  notificationRequestAttempted: false,
  serviceActive: false,
  petVisible: false,
};

function controlHost(initial: AndroidCapabilities) {
  let capabilities = initial;
  let listener: ((event: AndroidCapabilitiesEvent) => void) | undefined;
  const host: AndroidControlHost = {
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
    getCapabilities: vi.fn(async () => capabilities),
    requestNotifications: vi.fn(async () => {
      capabilities = { ...capabilities, notificationRequestAttempted: true };
      return capabilities;
    }),
    openOverlaySettings: vi.fn(async () => capabilities),
    startService: vi.fn(async () => {
      capabilities = { ...capabilities, serviceActive: true, petVisible: true };
      return capabilities;
    }),
    showPet: vi.fn(async () => {
      capabilities = { ...capabilities, serviceActive: true, petVisible: true };
      return capabilities;
    }),
    hidePet: vi.fn(async () => {
      capabilities = { ...capabilities, serviceActive: true, petVisible: false };
      return capabilities;
    }),
    quit: vi.fn(async () => {
      capabilities = { ...capabilities, serviceActive: false, petVisible: false };
      return capabilities;
    }),
    subscribeCapabilities: (next) => {
      listener = next;
      return () => { listener = undefined; };
    },
  };
  return {
    host,
    emit(next: AndroidCapabilities) {
      capabilities = next;
      listener?.({ type: 'capabilitiesChanged', capabilities: next });
    },
  };
}

function renderOnboarding(host: AndroidControlHost, locale: 'zh-CN' | 'en' = 'zh-CN') {
  return render(
    <I18nProvider locale={locale}>
      <AndroidOnboarding host={host} />
    </I18nProvider>,
  );
}

test('explains overlay permission before opening system settings', async () => {
  const user = userEvent.setup();
  const { host } = controlHost(api28Denied);
  renderOnboarding(host);

  await user.click(await screen.findByRole('button', { name: '启用悬浮宠物' }));
  expect(screen.getByText('允许宠物显示在其他应用上层')).toBeVisible();
  expect(host.openOverlaySettings).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: '前往授权' }));
  expect(host.openOverlaySettings).toHaveBeenCalledOnce();
});

test('requests Android 13 notification permission before opening overlay settings', async () => {
  const user = userEvent.setup();
  const { host } = controlHost(api35Denied);
  renderOnboarding(host);

  await user.click(await screen.findByRole('button', { name: '启用悬浮宠物' }));
  expect(screen.getByText('先允许通知，提醒服务运行时 Android 才能向你显示状态。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '前往授权' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '允许通知' }));
  expect(host.requestNotifications).toHaveBeenCalledOnce();
  expect(await screen.findByText('允许宠物显示在其他应用上层')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '前往授权' }));
  expect(host.openOverlaySettings).toHaveBeenCalledOnce();
});

test('rechecks resumed permission state and starts only after overlay permission is granted', async () => {
  const deniedAfterAttempt = { ...api35Denied, notificationRequestAttempted: true };
  const fixture = controlHost(deniedAfterAttempt);
  renderOnboarding(fixture.host);

  expect(await screen.findByRole('button', { name: '重新授权' })).toBeVisible();
  expect(fixture.host.startService).not.toHaveBeenCalled();

  act(() => fixture.emit({
    ...deniedAfterAttempt,
    overlayPermission: 'granted',
  }));

  await waitFor(() => expect(fixture.host.startService).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: '隐藏宠物' })).toBeVisible();
});

test('keeps notification retry and deterministic show hide quit controls available', async () => {
  const user = userEvent.setup();
  const fixture = controlHost({
    ...api35Denied,
    overlayPermission: 'granted',
    notificationRequestAttempted: true,
    serviceActive: true,
    petVisible: true,
  });
  renderOnboarding(fixture.host, 'en');

  expect(await screen.findByText('Closing settings does not stop reminders.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry notifications' }));
  expect(fixture.host.requestNotifications).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: 'Hide pet' }));
  expect(fixture.host.hidePet).toHaveBeenCalledOnce();
  expect(await screen.findByRole('button', { name: 'Show pet' })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Show pet' }));
  expect(fixture.host.showPet).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Quit app' }));
  expect(fixture.host.quit).toHaveBeenCalledOnce();
});
