import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { NotificationStatus } from './model';
import { CapabilityStatus } from './CapabilityStatus';
import { pwaStatus } from '../infrastructure/pwaStatus';
import { I18nProvider } from '../i18n/I18nProvider';

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  pwaStatus.reset();
});

function renderStatus(
  notificationStatus: NotificationStatus,
  storageMode: 'persistent' | 'temporary',
  offlineReady: boolean,
  locale: 'zh-CN' | 'en' = 'zh-CN',
  desktopShellAvailable = false,
) {
  return render(
    <I18nProvider locale={locale}>
      <CapabilityStatus
        notificationStatus={notificationStatus}
        storageMode={storageMode}
        offlineReady={offlineReady}
        desktopShellAvailable={desktopShellAvailable}
      />
    </I18nProvider>,
  );
}

test.each([
  ['denied', '系统通知已关闭，后台提醒可靠性会降低'],
  ['unavailable', '当前浏览器仅支持网页内提醒'],
])('shows %s notification capability honestly', (status, copy) => {
  renderStatus(status as NotificationStatus, 'persistent', true);
  expect(screen.getByText(copy)).toBeVisible();
  expect(screen.getByText('关闭网页或浏览器后，提醒不会继续运行。')).toBeVisible();
});

test.each(['default', 'granted'] as const)('omits non-degraded %s notification status globally', (status) => {
  renderStatus(status, 'persistent', true);
  expect(screen.queryByText(/系统通知/)).not.toBeInTheDocument();
  expect(screen.getByText('关闭网页或浏览器后，提醒不会继续运行。')).toBeVisible();
});

test('shows temporary storage and offline warnings', () => {
  renderStatus('granted', 'temporary', false);
  expect(screen.getByText('当前是临时会话，刷新后设置可能丢失')).toBeVisible();
  expect(screen.getByText('离线启动尚未准备好')).toBeVisible();
});

test('tracks whether the page is currently in the foreground', () => {
  renderStatus('granted', 'persistent', true);
  expect(screen.getByText('页面当前在前台运行')).toBeVisible();

  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('页面当前在后台运行')).toBeVisible();
});

test('distinguishes a failed offline registration from initial preparation', () => {
  pwaStatus.markRegistrationError();
  renderStatus('granted', 'persistent', false);
  expect(screen.getByText('离线能力不可用')).toBeVisible();
  expect(screen.queryByText('离线启动尚未准备好')).not.toBeInTheDocument();
});

test('shows capability guidance in English', () => {
  renderStatus('denied', 'temporary', false, 'en');
  expect(screen.getByRole('complementary', { name: 'Capability status' })).toBeVisible();
  expect(screen.getByText('System notifications are off, so background reminders may be less reliable.')).toBeVisible();
  expect(screen.getByText('This is a temporary session. Settings may be lost after refreshing.')).toBeVisible();
  expect(screen.getByText('Offline startup is not ready yet.')).toBeVisible();
});

test('shows native background guidance without browser lifecycle warnings', () => {
  renderStatus('granted', 'persistent', false, 'zh-CN', true);

  expect(screen.getByText('桌面应用正在后台运行，关闭设置窗口后提醒仍会继续。')).toBeVisible();
  expect(screen.queryByText('离线启动尚未准备好')).not.toBeInTheDocument();
  expect(screen.queryByText('页面当前在前台运行')).not.toBeInTheDocument();
  expect(screen.queryByText('关闭网页或浏览器后，提醒不会继续运行。')).not.toBeInTheDocument();
});

test('localizes native background guidance in English', () => {
  renderStatus('granted', 'persistent', false, 'en', true);

  expect(screen.getByText(
    'The desktop app keeps running in the background. Reminders continue after you close the settings window.',
  )).toBeVisible();
});
