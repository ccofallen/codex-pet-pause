import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  serviceActive: false,
  petVisible: false,
};

const api35Denied: AndroidCapabilities = {
  apiLevel: 35,
  overlayPermission: 'denied',
  notificationPermission: 'notRequested',
  serviceActive: false,
  petVisible: false,
};

function controlHost(initial: AndroidCapabilities) {
  let capabilities = initial;
  let listener: ((event: AndroidCapabilitiesEvent) => void) | undefined;
  const host: AndroidControlHost = {
    loadSnapshot: async () => null,
    loadRuntimeSnapshot: async () => null,
    clearSettings: async () => undefined,
    replaceHistory: async () => undefined,
    clearHistory: async () => undefined,
    clearPets: async () => undefined,
    saveSettings: async () => undefined,
    appendHistory: async () => undefined,
    pruneHistory: async () => undefined,
    savePet: async () => undefined,
    deletePet: async () => undefined,
    selectPet: async () => undefined,
    openPetdex: async () => undefined,
    pickPetFiles: async () => ({ status: 'cancelled', files: [] }),
    consumePendingArchive: async () => { throw new Error('no pending archive'); },
    completePendingArchive: async () => undefined,
    persistValidatedPet: async () => undefined,
    subscribePetArchives: () => () => undefined,
    subscribe: () => () => undefined,
    getCapabilities: vi.fn(async () => capabilities),
    requestNotifications: vi.fn(async () => {
      capabilities = { ...capabilities, notificationPermission: 'deniedCanAsk' };
      return capabilities;
    }),
    openNotificationSettings: vi.fn(async () => capabilities),
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
  const deniedAfterAttempt: AndroidCapabilities = {
    ...api35Denied,
    notificationPermission: 'deniedCanAsk',
  };
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
    notificationPermission: 'deniedCanAsk',
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

test('requests untouched notification permission before auto-starting an already-authorized overlay', async () => {
  const user = userEvent.setup();
  const fixture = controlHost({
    ...api35Denied,
    overlayPermission: 'granted',
  });
  renderOnboarding(fixture.host, 'en');

  expect(await screen.findByRole('button', { name: 'Allow notifications' })).toBeVisible();
  expect(fixture.host.startService).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Allow notifications' }));

  expect(fixture.host.requestNotifications).toHaveBeenCalledOnce();
  await waitFor(() => expect(fixture.host.startService).toHaveBeenCalledOnce());
});

test('opens app notification settings instead of repeating a blocked permission request', async () => {
  const user = userEvent.setup();
  const fixture = controlHost({
    ...api35Denied,
    overlayPermission: 'granted',
    notificationPermission: 'blocked',
    serviceActive: true,
  });
  renderOnboarding(fixture.host, 'en');

  await user.click(await screen.findByRole('button', { name: 'Open notification settings' }));

  expect(fixture.host.openNotificationSettings).toHaveBeenCalledOnce();
  expect(fixture.host.requestNotifications).not.toHaveBeenCalled();
});

test('updates blocked notification UI from a fresh Activity-resume capability event', async () => {
  const fixture = controlHost({
    ...api35Denied,
    overlayPermission: 'granted',
    notificationPermission: 'blocked',
    serviceActive: true,
  });
  renderOnboarding(fixture.host);

  expect(await screen.findByRole('button', { name: '打开通知设置' })).toBeVisible();
  act(() => fixture.emit({
    ...api35Denied,
    overlayPermission: 'granted',
    notificationPermission: 'granted',
    serviceActive: true,
  }));

  await waitFor(() => expect(screen.queryByRole('button', { name: '打开通知设置' }))
    .not.toBeInTheDocument());
});

test.each([
  ['zh-CN', '隐藏宠物', '退出应用'],
  ['en', 'Hide pet', 'Quit app'],
] as const)('renders only pet and quit controls after authorized startup in %s', async (locale, petControl, quitControl) => {
  const fixture = controlHost({
    ...api35Denied,
    overlayPermission: 'granted',
    notificationPermission: 'granted',
    serviceActive: true,
    petVisible: true,
  });
  renderOnboarding(fixture.host, locale);

  const petButton = await screen.findByRole('button', { name: petControl });
  const controls = petButton.closest<HTMLElement>('.android-onboarding');

  expect(controls).toHaveClass('android-onboarding--ready');
  expect(within(controls!).getAllByRole('button')).toHaveLength(2);
  expect(within(controls!).getByRole('button', { name: quitControl })).toBeVisible();
  expect(controls!.querySelectorAll('p, h3')).toHaveLength(0);
});

test.each([
  ['zh-CN', '启用悬浮宠物', '允许宠物显示在其他应用上层'],
  ['en', 'Enable floating pet', 'Allow the pet to appear over other apps'],
] as const)('retains overlay setup instructions in %s when permission is denied', async (locale, enableControl, instruction) => {
  const user = userEvent.setup();
  const { host } = controlHost(api28Denied);
  renderOnboarding(host, locale);

  await user.click(await screen.findByRole('button', { name: enableControl }));

  expect(screen.getByText(instruction)).toBeVisible();
});
