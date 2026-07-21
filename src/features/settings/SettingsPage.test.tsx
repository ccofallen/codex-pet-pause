import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AppProvider, useAppSnapshot } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { createDefaultSettings } from '../../app/defaults';
import type { AppSettings, AppSnapshot, QuietHours } from '../../app/model';
import { createFakeDependencies } from '../../test/fakes';
import { I18nProvider } from '../../i18n/I18nProvider';
import {
  applyReminderEdits, effectiveReminderRestartAt, SettingsPage, type SettingsPageProps,
} from './SettingsPage';

const NOW = new Date(2026, 6, 11, 9, 15).getTime();
const GLOBAL_CSS = readFileSync('src/styles/global.css', 'utf8');

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function LocalizedSettingsPage({ section, now }: Required<SettingsPageProps>) {
  const snapshot = useAppSnapshot();
  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <div className="app-shell"><SettingsPage section={section} now={now} /></div>
    </I18nProvider>
  );
}

async function setup(section: 'reminders' | 'general' = 'reminders', options: {
  notificationStatus?: 'default' | 'granted' | 'denied' | 'unavailable';
  settingsClearFailure?: boolean;
  historyClearFailure?: boolean;
  settings?: AppSettings;
} = {}) {
  const settings = options.settings ?? createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.reminders[1] = { ...settings.reminders[1]!, enabled: true, status: 'scheduled' };
  const deps = createFakeDependencies({
    now: NOW,
    settings,
    ...(options.notificationStatus === undefined ? {} : { notificationStatus: options.notificationStatus }),
  });
  deps.settings.clearFailure = options.settingsClearFailure ?? false;
  deps.history.clearFailure = options.historyClearFailure ?? false;
  const controller = createAppController(deps);
  await controller.hydrate();
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <LocalizedSettingsPage section={section} now={() => NOW} />
    </AppProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return { user, controller, deps };
}

beforeEach(() => vi.useRealTimers());

test('applyReminderEdits restarts only newly enabled or changed enabled reminders', () => {
  const current = createDefaultSettings(NOW).reminders.map((reminder, index) => ({
    ...reminder,
    enabled: index < 2,
    status: index < 2 ? 'snoozed' as const : 'disabled' as const,
    snoozedUntil: NOW + 1_000,
  }));
  const draft = current.map((reminder) => {
    if (reminder.id === 'lookAway') return { ...reminder, intervalMinutes: 25 };
    if (reminder.id === 'drinkWater') return reminder;
    if (reminder.id === 'standUp') return { ...reminder, enabled: true };
    return { ...reminder, intervalMinutes: 120 };
  });
  const result = applyReminderEdits(current, draft, NOW);
  expect(result.find(({ id }) => id === 'lookAway')).toMatchObject({ nextDueAt: NOW + 25 * 60_000, status: 'scheduled', snoozedUntil: undefined });
  expect(result.find(({ id }) => id === 'drinkWater')).toBe(draft[1]);
  expect(result.find(({ id }) => id === 'standUp')).toMatchObject({ nextDueAt: NOW + 60 * 60_000, status: 'scheduled', snoozedUntil: undefined });
  expect(result.find(({ id }) => id === 'takeBreak')).toMatchObject({ nextDueAt: current[3]!.nextDueAt, status: 'disabled' });
});

function restartSnapshot(runtime: AppSettings['runtime'], quietHours: QuietHours): AppSnapshot {
  const settings = createDefaultSettings(NOW);
  settings.quietHours = quietHours;
  settings.runtime = runtime;
  return {
    ready: true,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [], ...runtime },
    storageMode: 'persistent',
    notificationStatus: 'granted',
    pets: [],
  };
}

test('effectiveReminderRestartAt ignores replaced quiet and expired pause anchors', () => {
  const oldQuiet = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
  const snapshot = restartSnapshot({
    pausedAt: NOW - 75 * 60_000,
    pausedUntil: NOW - 15 * 60_000,
    quietStartedAt: NOW - 15 * 60_000,
  }, oldQuiet);

  expect(effectiveReminderRestartAt(snapshot, NOW, { ...oldQuiet, enabled: false })).toBe(NOW);
});

test('effectiveReminderRestartAt keeps an active pause anchor when quiet hours change', () => {
  const oldQuiet = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
  const pausedAt = NOW - 20 * 60_000;
  const snapshot = restartSnapshot({
    pausedAt,
    pausedUntil: NOW + 40 * 60_000,
    quietStartedAt: NOW - 15 * 60_000,
  }, oldQuiet);

  expect(effectiveReminderRestartAt(snapshot, NOW, { ...oldQuiet, enabled: false })).toBe(pausedAt);
});

test('effectiveReminderRestartAt ignores an expired overnight quiet runtime', () => {
  const quiet = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
  const quietStartedAt = new Date(2026, 6, 10, 22).getTime();
  const snapshot = restartSnapshot({ quietStartedAt }, quiet);

  expect(effectiveReminderRestartAt(snapshot, NOW, quiet)).toBe(NOW);
});

test('effectiveReminderRestartAt keeps the current overnight quiet runtime', () => {
  const now = new Date(2026, 6, 12, 1, 30).getTime();
  const quietStartedAt = new Date(2026, 6, 11, 22).getTime();
  const quiet = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
  const snapshot = restartSnapshot({ quietStartedAt }, quiet);

  expect(effectiveReminderRestartAt(snapshot, now, quiet)).toBe(quietStartedAt);
});

describe('reminder settings', () => {
  test('localizes preset reminders, validation, quiet hours, save, and pause controls in English', async () => {
    const settings = createDefaultSettings(NOW, 'en');
    const { user, controller } = await setup('reminders', { settings });
    const save = vi.spyOn(controller, 'saveSettings');

    expect(screen.getByRole('heading', { name: 'Reminders' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Drink water' })).toBeVisible();
    expect(screen.getByLabelText('Drink water interval (minutes)')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Quiet hours' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pause for 30 minutes' })).toBeVisible();

    await user.clear(screen.getByLabelText('Drink water interval (minutes)'));
    await user.type(screen.getByLabelText('Drink water interval (minutes)'), '7.5');
    await user.click(screen.getByRole('checkbox', { name: 'Enable quiet hours' }));
    await user.clear(screen.getByLabelText('Quiet hours end'));
    await user.type(screen.getByLabelText('Quiet hours end'), '22:00');
    await user.click(screen.getByRole('button', { name: 'Save reminder settings' }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Drink water interval must be a whole number from 1 to 720; Quiet hours cannot start and end at the same time',
    );
  });

  test('places custom reminders after presets and before quiet settings', async () => {
    await setup();
    const form = screen.getByRole('button', { name: '保存提醒设置' }).closest('form')!;
    const children = Array.from(form.children);
    expect(children.indexOf(screen.getByRole('region', { name: '自定义提醒' })))
      .toBe(children.indexOf(form.querySelector('.settings-grid')!) + 1);
    expect(children.indexOf(screen.getByRole('region', { name: '自定义提醒' })))
      .toBeLessThan(children.indexOf(form.querySelector('.quiet-settings')!));
  });

  test('restarts an edited interval from save time when active quiet hours are disabled', async () => {
    const settings = createDefaultSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    settings.runtime.quietStartedAt = NOW - 15 * 60_000;
    const { user, controller } = await setup('reminders', { settings });

    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.click(screen.getByRole('checkbox', { name: '启用静默时段' }));
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));

    expect(controller.getSnapshot().scheduler.reminders[1]?.nextDueAt).toBe(NOW + 75 * 60_000);
  });

  test('restarts an edited interval after newly changed active quiet hours end', async () => {
    const settings = createDefaultSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    settings.runtime.quietStartedAt = NOW - 15 * 60_000;
    const { user, controller, deps } = await setup('reminders', { settings });

    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.clear(screen.getByLabelText('静默结束时间'));
    await user.type(screen.getByLabelText('静默结束时间'), '10:30');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));
    deps.clock.set(new Date(2026, 6, 11, 10, 30).getTime());
    await controller.reconcileNow();

    expect(controller.getSnapshot().scheduler.reminders[1]?.nextDueAt)
      .toBe(new Date(2026, 6, 11, 11, 45).getTime());
  });

  test('keeps an active pause as the restart anchor when quiet hours change', async () => {
    const settings = createDefaultSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 9 * 60, endMinutes: 10 * 60 };
    settings.runtime = {
      pausedAt: NOW - 20 * 60_000,
      pausedUntil: NOW + 40 * 60_000,
      quietStartedAt: NOW - 15 * 60_000,
    };
    const { user, controller, deps } = await setup('reminders', { settings });

    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.click(screen.getByRole('checkbox', { name: '启用静默时段' }));
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));
    deps.clock.set(NOW + 15 * 60_000);
    await controller.resumePause();

    expect(controller.getSnapshot().scheduler.reminders[1]?.nextDueAt)
      .toBe(NOW + 90 * 60_000);
  });

  test('ignores an expired pause when restarting an edited interval', async () => {
    const settings = createDefaultSettings(NOW);
    settings.runtime = {
      pausedAt: NOW - 75 * 60_000,
      pausedUntil: NOW - 15 * 60_000,
    };
    const { user, controller } = await setup('reminders', { settings });

    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));

    expect(controller.getSnapshot().scheduler.reminders[1]?.nextDueAt).toBe(NOW + 75 * 60_000);
  });

  test('restarts an edited interval from save time when an overnight quiet runtime already expired', async () => {
    const settings = createDefaultSettings(NOW);
    settings.quietHours = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    settings.runtime.quietStartedAt = new Date(2026, 6, 10, 22).getTime();
    const { user, controller } = await setup('reminders', { settings });

    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));

    expect(controller.getSnapshot().scheduler.reminders[1]?.nextDueAt).toBe(NOW + 75 * 60_000);
  });

  test('edits reminders, theme-independent quiet hours, and optional action duration', async () => {
    const { user, controller } = await setup();
    const save = vi.spyOn(controller, 'saveSettings');
    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '75');
    await user.click(screen.getByRole('checkbox', { name: '启用目视远方提醒' }));
    await user.type(screen.getByLabelText('目视远方行动倒计时（秒，可选）'), '30');
    await user.click(screen.getByRole('checkbox', { name: '启用静默时段' }));
    await user.clear(screen.getByLabelText('静默开始时间'));
    await user.type(screen.getByLabelText('静默开始时间'), '22:30');
    await user.clear(screen.getByLabelText('静默结束时间'));
    await user.type(screen.getByLabelText('静默结束时间'), '07:15');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      quietHours: { enabled: true, startMinutes: 1350, endMinutes: 435 },
      reminders: expect.arrayContaining([
        expect.objectContaining({ type: 'drinkWater', intervalMinutes: 75, nextDueAt: NOW + 75 * 60_000, status: 'scheduled' }),
        expect.objectContaining({ type: 'lookAway', optionalActionDurationSeconds: 30, nextDueAt: NOW + 20 * 60_000, status: 'scheduled' }),
        expect.not.objectContaining({ type: 'drinkWater', optionalActionDurationSeconds: expect.anything() }),
      ]),
    }));
  });

  test('rejects invalid numeric and equal enabled quiet-hour values without saving', async () => {
    const { user, controller } = await setup();
    const save = vi.spyOn(controller, 'saveSettings');
    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '7.5');
    await user.click(screen.getByRole('checkbox', { name: '启用静默时段' }));
    await user.clear(screen.getByLabelText('静默结束时间'));
    await user.type(screen.getByLabelText('静默结束时间'), '22:00');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('间隔必须是 1 到 720 的整数');
    expect(screen.getByRole('alert')).toHaveTextContent('静默开始和结束时间不能相同');
  });

  test.each(['1e2', '0x10', ' 20 ', '7.5', 'NaN'])('rejects non-lexical decimal interval %s', async (value) => {
    const { user, controller } = await setup();
    const save = vi.spyOn(controller, 'saveSettings');
    fireEvent.change(screen.getByLabelText('喝水间隔（分钟）'), { target: { value } });
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));
    expect(save).not.toHaveBeenCalled();
  });

  test('keeps a dirty reminder draft when an external snapshot update arrives', async () => {
    const { user, controller } = await setup();
    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '88');
    await act(() => controller.pause(30));
    expect(screen.getByLabelText('喝水间隔（分钟）')).toHaveValue('88');
  });

  test('rejects an out-of-range optional action duration', async () => {
    const { user, controller } = await setup();
    const save = vi.spyOn(controller, 'saveSettings');
    await user.type(screen.getByLabelText('目视远方行动倒计时（秒，可选）'), '9');
    await user.click(screen.getByRole('button', { name: '保存提醒设置' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('行动倒计时必须是 10 到 7200 的整数');
  });

  test('pauses, displays an exact local end time, resumes, and prevents duplicate pause requests', async () => {
    const { user, controller } = await setup();
    let release!: () => void;
    const pause = vi.spyOn(controller, 'pause').mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    await user.dblClick(screen.getByRole('button', { name: '暂停 30 分钟' }));
    expect(pause).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: '暂停 30 分钟' })).toBeEnabled());
    pause.mockRestore();

    await controller.pause(30);
    expect(await screen.findByText(/暂停至/)).toHaveTextContent(new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit',
    }).format(NOW + 30 * 60_000));
    await user.click(screen.getByRole('button', { name: '立即恢复' }));
    expect(controller.getSnapshot().scheduler.pausedUntil).toBeUndefined();
  });

  test('guards rapid same-turn pause and reminder-save submissions synchronously', async () => {
    const { controller } = await setup();
    let releasePause!: () => void;
    const pause = vi.spyOn(controller, 'pause').mockImplementation(() => new Promise<void>((resolve) => { releasePause = resolve; }));
    const pauseButton = screen.getByRole('button', { name: '暂停 30 分钟' });
    fireEvent.click(pauseButton);
    fireEvent.click(pauseButton);
    expect(pause).toHaveBeenCalledTimes(1);
    releasePause();
    await waitFor(() => expect(pauseButton).toBeEnabled());

    let releaseSave!: () => void;
    const save = vi.spyOn(controller, 'saveSettings').mockImplementation(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
    const saveButton = screen.getByRole('button', { name: '保存提醒设置' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(save).toHaveBeenCalledTimes(1);
    releaseSave();
  });

  test('does not replace an existing timed pause', async () => {
    const { user, controller } = await setup();
    await user.click(screen.getByRole('button', { name: '暂停 30 分钟' }));
    const pause = vi.spyOn(controller, 'pause');
    expect(await screen.findByRole('button', { name: '暂停 60 分钟' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '暂停 60 分钟' }));
    expect(pause).not.toHaveBeenCalled();
  });

  test('treats an unreconciled expired pause as inactive and permits a new pause', async () => {
    const settings = createDefaultSettings(NOW);
    settings.runtime = {
      pausedAt: NOW - 45 * 60_000,
      pausedUntil: NOW,
    };
    const { user, controller } = await setup('reminders', { settings });

    const pauseButton = screen.getByRole('button', { name: '暂停 30 分钟' });
    expect(pauseButton).toBeEnabled();
    expect(screen.queryByText(/暂停至/)).not.toBeInTheDocument();

    await user.click(pauseButton);

    expect(controller.getSnapshot().scheduler).toMatchObject({
      pausedAt: NOW,
      pausedUntil: NOW + 30 * 60_000,
    });
  });
});

describe('general settings', () => {
  test('keeps general settings, notification permission, and reset available while a locale write is pending', async () => {
    const { controller } = await setup('general');
    const localeGate = deferred();
    vi.spyOn(controller, 'setLocale').mockImplementation(() => localeGate.promise);
    const requestNotifications = vi.spyOn(controller, 'requestNotifications').mockResolvedValue('granted');

    fireEvent.click(screen.getByRole('radio', { name: 'English' }));

    expect(screen.getByRole('radio', { name: 'English' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存应用设置' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '开启系统通知' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '清除全部本地数据' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    expect(screen.getByRole('dialog', { name: '删除本机数据？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '开启系统通知' }));
    expect(requestNotifications).toHaveBeenCalledTimes(1);

    await act(async () => { localeGate.resolve(); await Promise.resolve(); });
  });

  test('merges a locale write with a concurrent general settings save', async () => {
    const { controller, deps } = await setup('general');
    const localeGate = deferred();
    const actualSetLocale = controller.setLocale.bind(controller);
    const setLocale = vi.spyOn(controller, 'setLocale').mockImplementation(
      (locale) => localeGate.promise.then(() => actualSetLocale(locale)),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: '夜间' }));
      fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    });
    expect(screen.getByRole('button', { name: '保存应用设置' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存应用设置' }));
    expect(setLocale).toHaveBeenCalledWith('en');

    await act(async () => { localeGate.resolve(); await Promise.resolve(); });

    await waitFor(() => expect(controller.getSnapshot().settings).toMatchObject({ locale: 'en', theme: 'dark' }));
    expect(deps.settings.value).toMatchObject({ locale: 'en', theme: 'dark' });
  });

  test('translates feedback from an action that settles after an external locale change', async () => {
    const { controller } = await setup('general');
    const notificationGate = deferred<'granted'>();
    vi.spyOn(controller, 'requestNotifications').mockImplementation(() => notificationGate.promise);
    const actualSave = controller.saveSettings.bind(controller);

    fireEvent.click(screen.getByRole('button', { name: '开启系统通知' }));
    await act(() => actualSave({ ...controller.getSnapshot().settings, locale: 'en' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await act(async () => { notificationGate.reject(new Error('request failed')); await Promise.resolve(); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not request notification permission. Try again.');
  });

  test('keeps reset focus stable across locale rerenders and closes with the latest Escape handler', async () => {
    const { user, controller, deps } = await setup('general');
    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    const acknowledgment = screen.getByRole('checkbox', { name: '我了解本机数据将被删除' });
    await user.click(acknowledgment);
    expect(acknowledgment).toHaveFocus();

    await act(() => controller.saveSettings({ ...controller.getSnapshot().settings, locale: 'en' }));

    const localizedAcknowledgment = screen.getByRole('checkbox', { name: 'I understand that local data will be deleted' });
    expect(localizedAcknowledgment).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deps.settings.cleared).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear all local data' })).toHaveFocus());
  });

  test('applies and persists only the selected locale while preserving an unsaved theme draft and focus', async () => {
    const { user, controller, deps } = await setup('general');
    await user.click(screen.getByRole('radio', { name: '夜间' }));

    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(controller.getSnapshot().settings.locale).toBe('en');
    expect(controller.getSnapshot().settings.theme).toBe('system');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Language preference saved');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'English' }));
    expect(deps.settings.value).toMatchObject({ locale: 'en', theme: 'system' });

    const reloaded = createAppController(deps);
    await reloaded.hydrate();
    expect(reloaded.getSnapshot().settings.locale).toBe('en');
  });

  test('keeps a session-only locale applied and reports the persistence warning in that locale', async () => {
    const { user, controller, deps } = await setup('general');
    deps.settings.saveFailure = true;

    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(controller.getSnapshot().settings.locale).toBe('en');
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(await screen.findByRole('alert')).toHaveTextContent('Applied for this session, but could not save on this device');
  });

  test('keeps the controller locale selected and reports a rejecting save in that locale', async () => {
    const { user, controller } = await setup('general');
    vi.spyOn(controller, 'setLocale').mockRejectedValueOnce(new Error('rejected before publish'));

    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(controller.getSnapshot().settings.locale).toBe('zh-CN');
    expect(screen.getByRole('radio', { name: '中文' })).toBeChecked();
    expect(await screen.findByRole('alert')).toHaveTextContent('无法保存语言设置，请重试');
  });

  test('localizes general settings, notification guidance, and the reset dialog in English', async () => {
    const settings = createDefaultSettings(NOW, 'en');
    const { user } = await setup('general', { settings });

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Use system setting' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Reminder sound' })).toBeVisible();
    expect(screen.getByText('System notifications are not enabled yet. Allow them to receive reminders while this page is in the background.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save application settings' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear all local data' }));
    expect(screen.getByRole('dialog', { name: 'Delete local data?' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'I understand that local data will be deleted' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete and start over' })).toBeVisible();
  });

  test('credits the approved ElevenLabs sound effect with an accessible source link', async () => {
    await setup('general');

    const credit = screen.getByRole('link', { name: '“探索好奇猫咪叫”音效来源：elevenlabs.io' });
    expect(credit).toBeVisible();
    expect(credit).toHaveAttribute('href', 'https://elevenlabs.io/zh/sound-effects/kittens-meowing');
  });

  test('includes the required English ElevenLabs attribution in the bootstrap title', () => {
    expect(readFileSync('index.html', 'utf8')).toContain('<title>Codex Pet Pause · Cat sound: elevenlabs.io</title>');
  });

  test('saves theme, sound, and animations', async () => {
    const { user, controller } = await setup('general');
    const save = vi.spyOn(controller, 'saveSettings');
    await user.click(screen.getByRole('radio', { name: '夜间' }));
    await user.click(screen.getByRole('checkbox', { name: '提醒声音' }));
    await user.click(screen.getByRole('checkbox', { name: '界面动画' }));
    await user.click(screen.getByRole('button', { name: '保存应用设置' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark', soundEnabled: true, animationsEnabled: false }));
  });

  test('reports a session-only save honestly, then clears that warning after persistence recovers', async () => {
    const { user, deps } = await setup('general');
    deps.settings.saveFailure = true;
    await user.click(screen.getByRole('button', { name: '保存应用设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已应用到当前会话，但无法保存到本机');
    expect(screen.queryByText('应用设置已保存')).not.toBeInTheDocument();
    deps.settings.saveFailure = false;
    await user.click(screen.getByRole('button', { name: '保存应用设置' }));
    expect(await screen.findByText('应用设置已保存')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test.each([
    ['denied', '通知已被浏览器阻止，请在浏览器设置中允许通知。'],
    ['unavailable', '当前浏览器不支持系统通知，仍可使用网页内提醒。'],
  ] as const)('shows persistent %s guidance and never requests again', async (status, guidance) => {
    const { controller, deps } = await setup('general', { notificationStatus: status });
    expect(screen.getByText(guidance)).toBeVisible();
    expect(screen.queryByRole('button', { name: '开启系统通知' })).not.toBeInTheDocument();
    expect(deps.notifications.requests).toBe(0);
    expect(controller.getSnapshot().notificationStatus).toBe(status);
  });

  test('requests notification permission only from the default state', async () => {
    const { user, deps } = await setup('general', { notificationStatus: 'default' });
    await user.click(screen.getByRole('button', { name: '开启系统通知' }));
    expect(deps.notifications.requests).toBe(1);
    expect(await screen.findByText('系统通知已开启。')).toBeVisible();
  });

  test('portals reset outside the shell, isolates it, and restores access on close', async () => {
    const { user } = await setup('general');
    const shell = document.querySelector<HTMLElement>('.app-shell')!;

    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));

    const dialog = screen.getByRole('dialog', { name: '删除本机数据？' });
    expect(shell).toHaveAttribute('inert');
    expect(shell).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shell).not.toHaveAttribute('inert');
  });

  test('restores a shell that was already inert after an overlapping reset lifetime', async () => {
    await setup('general');
    const shell = document.querySelector<HTMLElement>('.app-shell')!;
    const opener = screen.getByRole('button', { name: '清除全部本地数据' });
    shell.setAttribute('inert', '');

    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: '删除本机数据？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(shell).toHaveAttribute('inert');
    shell.removeAttribute('inert');
  });

  test('layers the reset backdrop above the global cat and reminder bubble', () => {
    const backdropRule = GLOBAL_CSS.match(/\.modal-backdrop\s*\{([^}]*)\}/s)?.[1] ?? '';
    const zIndex = Number(backdropRule.match(/z-index:\s*(\d+)/)?.[1]);

    expect(zIndex).toBeGreaterThan(21);
  });

  test('requires acknowledgment, keeps failed reset open, and can retry successfully', async () => {
    const { user, controller, deps } = await setup('general', { settingsClearFailure: true });
    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    expect(screen.getByRole('dialog', { name: '删除本机数据？' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '删除并重新开始' }));
    expect(deps.settings.cleared).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('请先确认');
    await user.click(screen.getByRole('checkbox', { name: '我了解本机数据将被删除' }));
    await user.click(screen.getByRole('button', { name: '删除并重新开始' }));
    expect(await screen.findByText('部分本机数据可能已删除，未能完成，请重试')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: '我了解本机数据将被删除' })).toBeChecked();
    deps.settings.clearFailure = false;
    await user.click(screen.getByRole('button', { name: '删除并重新开始' }));
    await waitFor(() => expect(controller.getSnapshot().settings.onboardingComplete).toBe(false));
  });

  test('Escape and cancel close reset without deleting', async () => {
    const { user, deps } = await setup('general');
    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deps.settings.cleared).toBe(false);
    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(deps.history.cleared).toBe(false);
  });

  test('submits data deletion once while it is pending', async () => {
    const { user, controller } = await setup('general');
    let release!: () => void;
    const clear = vi.spyOn(controller, 'clearAll').mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    await user.click(screen.getByRole('button', { name: '清除全部本地数据' }));
    await user.click(screen.getByRole('checkbox', { name: '我了解本机数据将被删除' }));
    await user.dblClick(screen.getByRole('button', { name: '删除并重新开始' }));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('guards reset synchronously, traps focus while pending, and restores opener focus on cancel', async () => {
    const { user, controller } = await setup('general');
    const opener = screen.getByRole('button', { name: '清除全部本地数据' });
    await user.click(opener);
    await user.click(screen.getByRole('checkbox', { name: '我了解本机数据将被删除' }));
    let release!: () => void;
    const clear = vi.spyOn(controller, 'clearAll').mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const confirm = screen.getByRole('button', { name: '删除并重新开始' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(clear).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    expect(dialog).toHaveFocus();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(opener).toHaveFocus();
  });
});
