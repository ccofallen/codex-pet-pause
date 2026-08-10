import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppProvider } from '../../../app/AppProvider';
import { createDefaultSettings } from '../../../app/defaults';
import type { AppController } from '../../../app/appController';
import type { AppSnapshot } from '../../../app/model';
import type { PresetReminderType, Reminder } from '../domain/types';
import { createCustomReminder } from '../domain/scheduler';
import { Dashboard, getReminderSummaries } from './Dashboard';
import { I18nProvider } from '../../../i18n/I18nProvider';

const NOW = new Date('2026-07-11T09:00:00Z').getTime();
const reminderTypes: PresetReminderType[] = ['lookAway', 'drinkWater', 'standUp', 'takeBreak'];

function snapshotWithDueTimes(dueInMinutes: number[]): AppSnapshot {
  const settings = createDefaultSettings(NOW);
  const reminders = dueInMinutes.map((minutes, index): Reminder => ({
    id: reminderTypes[index] ?? `extra-${index}`,
    kind: 'preset',
    type: reminderTypes[index] ?? 'lookAway',
    enabled: true,
    intervalMinutes: minutes,
    nextDueAt: NOW + minutes * 60_000,
    status: 'scheduled',
  }));
  settings.reminders = reminders;
  return {
    ready: true,
    settings,
    scheduler: { reminders, dueQueue: [] },
    storageMode: 'persistent',
    notificationStatus: 'default',
    pets: [],
  };
}

function controllerFor(snapshot: AppSnapshot): AppController {
  return {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => undefined),
    hydrate: vi.fn(async () => undefined),
    applyCommittedRuntimeState: vi.fn(),
    reconcileNow: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    snooze: vi.fn(async () => undefined),
    skip: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resumePause: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    saveSettings: vi.fn(async () => undefined),
    savePet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined),
    selectPet: vi.fn(async () => undefined),
    savePetPosition: vi.fn(async () => undefined),
    requestNotifications: vi.fn(async (): Promise<AppSnapshot['notificationStatus']> => 'default'),
    listHistorySince: vi.fn(async () => []),
    clearAll: vi.fn(async () => undefined),
  };
}

function renderWithSnapshot(
  snapshot: AppSnapshot,
  locale: 'zh-CN' | 'en' = 'zh-CN',
  pauseWhenHidden = false,
) {
  const controller = controllerFor(snapshot);
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><Dashboard pauseWhenHidden={pauseWhenHidden} /></I18nProvider>
    </AppProvider>,
  );
  return controller;
}

function disableAllReminders(snapshot: AppSnapshot): AppSnapshot {
  const reminders = snapshot.scheduler.reminders.map((reminder) => ({
    ...reminder,
    enabled: false,
    status: 'disabled' as const,
  }));
  return {
    ...snapshot,
    settings: { ...snapshot.settings, reminders },
    scheduler: { ...snapshot.scheduler, reminders },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test('shows the nearest reminder and sorted remaining reminders', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  renderWithSnapshot(snapshotWithDueTimes([60, 12, 41, 28]));

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('12 分钟');
  expect(screen.getAllByTestId('later-reminder').map((el) => el.textContent)).toEqual([
    expect.stringContaining('28 分钟'),
    expect.stringContaining('41 分钟'),
    expect.stringContaining('60 分钟'),
  ]);
  expect(screen.getByText('所有提醒均按计划进行')).toBeInTheDocument();
});

test('shows a custom reminder label in the schedule', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([20]);
  const custom = createCustomReminder('custom-medicine', '吃药', 30, NOW - 30 * 60_000, true);
  snapshot.settings.reminders = [custom];
  snapshot.scheduler = {
    reminders: [custom],
    dueQueue: [{ reminderId: custom.id, dueAt: NOW }],
  };

  renderWithSnapshot(snapshot);

  expect(screen.getByRole('heading', { name: '吃药' })).toBeVisible();
  expect(screen.getByText('1 项提醒待处理')).toBeVisible();
});

test.each([
  [1, '1 reminder needs attention'],
  [2, '2 reminders need attention'],
] as const)('uses English due-reminder pluralization for %i reminder(s)', (count, expected) => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10, 20]);
  snapshot.notificationStatus = 'granted';
  snapshot.scheduler.dueQueue = snapshot.scheduler.reminders.slice(0, count).map((reminder) => ({
    reminderId: reminder.id,
    dueAt: NOW,
  }));
  renderWithSnapshot(snapshot, 'en');

  expect(screen.getByText(expected)).toBeVisible();
});

test('shows the English on-schedule status', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.notificationStatus = 'granted';
  renderWithSnapshot(snapshot, 'en');

  expect(screen.getByText('All reminders are on schedule')).toBeVisible();
});

test('projects only enabled reminders, prefers snooze time, and never returns negative time', () => {
  const reminders = snapshotWithDueTimes([10, 20, 30]).scheduler.reminders;
  reminders[0] = { ...reminders[0]!, snoozedUntil: NOW + 40 * 60_000, status: 'snoozed' };
  reminders[1] = { ...reminders[1]!, enabled: false, status: 'disabled' };
  reminders[2] = { ...reminders[2]!, nextDueAt: NOW - 1_000 };

  expect(getReminderSummaries(reminders, NOW).map(({ id, remainingSeconds }) => ({ id, remainingSeconds })))
    .toEqual([
      { id: 'standUp', remainingSeconds: 0 },
      { id: 'lookAway', remainingSeconds: 2_400 },
    ]);
});

test('updates the display countdown once per second without reconciling the scheduler', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([12 / 60]);
  const controller = renderWithSnapshot(snapshot);
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('12 秒');

  act(() => vi.advanceTimersByTime(1_000));

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('11 秒');
  expect(controller.reconcileNow).not.toHaveBeenCalled();
});

test('a committed runtime deadline restarts the mounted countdown and keeps decrementing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const deps = (await import('../../../test/fakes')).createFakeDependencies({ now: NOW });
  const controller = (await import('../../../app/appController')).createAppController(deps);
  await controller.hydrate();
  render(
    <AppProvider controller={controller} lifecycle="passive">
      <I18nProvider locale="en"><Dashboard /></I18nProvider>
    </AppProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  const settings = createDefaultSettings(NOW, 'en');
  settings.reminders = settings.reminders.map((reminder, index) => ({
    ...reminder,
    enabled: true,
    status: 'scheduled' as const,
    nextDueAt: NOW + (index + 1) * 60_000,
  }));

  act(() => controller.applyCommittedRuntimeState({ revision: 1, settings }));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('1 minute');

  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('59 seconds');
});

test('countdown pauses while hidden and recalculates immediately when visible', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  renderWithSnapshot(snapshotWithDueTimes([12 / 60]), 'en', true);
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('12 seconds');

  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => vi.advanceTimersByTime(5_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('12 seconds');

  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('7 seconds');

  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('6 seconds');
  visibility.mockRestore();
});

test('没有启用提醒时只显示空状态，不声称提醒正在按计划运行', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  renderWithSnapshot(disableAllReminders(snapshotWithDueTimes([10, 20])));

  expect(screen.getAllByText('还没有启用提醒。')).toHaveLength(1);
  expect(screen.queryByText('所有提醒均按计划进行')).not.toBeInTheDocument();
});

test('暂停中优先显示暂停状态', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.pausedAt = NOW;
  snapshot.scheduler.pausedUntil = NOW + 30 * 60_000;
  renderWithSnapshot(snapshot);

  expect(screen.getByText('提醒已暂停。')).toBeInTheDocument();
  expect(screen.getByTestId('pause-remaining')).toHaveTextContent('30 分钟');
  expect(screen.queryByText('所有提醒均按计划进行')).not.toBeInTheDocument();
});

test('暂停期间倒计时冻结，但剩余暂停时间继续下降并在零处停止', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.pausedAt = NOW;
  snapshot.scheduler.pausedUntil = NOW + 2_000;
  renderWithSnapshot(snapshot);

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('10 分钟');
  expect(screen.getByTestId('pause-remaining')).toHaveTextContent('2 秒');

  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('10 分钟');
  expect(screen.getByTestId('pause-remaining')).toHaveTextContent('1 秒');

  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('10 分钟');
  expect(screen.getByTestId('pause-remaining')).toHaveTextContent('0 秒');
});

test('静默时段优先显示静默状态', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.quietStartedAt = NOW;
  renderWithSnapshot(snapshot);

  expect(screen.getByText('当前处于静默时段。')).toBeInTheDocument();
  expect(screen.queryByText('所有提醒均按计划进行')).not.toBeInTheDocument();
});

test('静默期间推进展示时钟不会降低提醒倒计时', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.quietStartedAt = NOW;
  renderWithSnapshot(snapshot);

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('10 分钟');

  act(() => vi.advanceTimersByTime(5_000));

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('10 分钟');
});

test.each([
  ['paused', '提醒已暂停。'],
  ['quiet', '当前处于静默时段。'],
] as const)('待处理项与 %s 抑制状态同时可见', (suppression, statusText) => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.dueQueue = [
    { reminderId: snapshot.scheduler.reminders[0]!.id, dueAt: NOW },
  ];
  if (suppression === 'paused') {
    snapshot.scheduler.pausedAt = NOW;
    snapshot.scheduler.pausedUntil = NOW + 30 * 60_000;
  } else {
    snapshot.scheduler.quietStartedAt = NOW;
  }
  renderWithSnapshot(snapshot);

  expect(screen.getByText('1 项提醒待处理')).toBeInTheDocument();
  expect(screen.getByText(statusText)).toBeInTheDocument();
});

test('暂停与静默重叠时用连续抑制的最早起点冻结倒计时，并同时显示两种状态', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.scheduler.quietStartedAt = NOW - 5 * 60_000;
  snapshot.scheduler.pausedAt = NOW;
  snapshot.scheduler.pausedUntil = NOW + 30 * 60_000;
  renderWithSnapshot(snapshot);

  expect(screen.getByTestId('next-reminder')).toHaveTextContent('15 分钟');
  expect(screen.getByText('提醒已暂停。')).toBeInTheDocument();
  expect(screen.getByText('当前处于静默时段。')).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(5_000));
  expect(screen.getByTestId('next-reminder')).toHaveTextContent('15 分钟');
});

test.each([
  ['default', '系统通知尚未开启，请保持网页打开或授权通知。'],
  ['denied', '系统通知已被阻止，请在浏览器设置中允许通知。'],
  ['unavailable', '当前浏览器不支持系统通知，请保持网页打开。'],
] as const)('通知状态为 %s 时持续显示恢复提醒的指引', (notificationStatus, guidance) => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.notificationStatus = notificationStatus;
  renderWithSnapshot(snapshot);

  expect(screen.getByText('所有提醒均按计划进行')).toBeInTheDocument();
  expect(screen.getByText(guidance)).toBeInTheDocument();
});

test('通知已授权且正常运行时不显示通知警告', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10]);
  snapshot.notificationStatus = 'granted';
  renderWithSnapshot(snapshot);

  expect(screen.getByText('所有提醒均按计划进行')).toBeInTheDocument();
  expect(screen.queryByTestId('notification-guidance')).not.toBeInTheDocument();
});

test('有待处理项时显示数量，不同时声称所有提醒正常', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot = snapshotWithDueTimes([10, 20]);
  snapshot.notificationStatus = 'granted';
  snapshot.scheduler.dueQueue = [
    { reminderId: snapshot.scheduler.reminders[0]!.id, dueAt: NOW },
  ];
  renderWithSnapshot(snapshot);

  expect(screen.getByText('1 项提醒待处理')).toBeInTheDocument();
  expect(screen.queryByText('所有提醒均按计划进行')).not.toBeInTheDocument();
});
