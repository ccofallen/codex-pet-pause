import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AppProvider, useAppSnapshot } from '../../app/AppProvider';
import { createAppController } from '../../app/appController';
import { createDefaultSettings } from '../../app/defaults';
import type { AppSettings } from '../../app/model';
import { createCustomReminder } from '../reminders/domain/scheduler';
import { createFakeDependencies } from '../../test/fakes';
import { I18nProvider } from '../../i18n/I18nProvider';
import { SettingsPage } from './SettingsPage';

const NOW = new Date(2026, 6, 11, 9, 15).getTime();

function LocalizedReminderSettings() {
  const snapshot = useAppSnapshot();
  return (
    <I18nProvider locale={snapshot.settings.locale}>
      <div className="app-shell"><SettingsPage section="reminders" now={() => NOW} /></div>
    </I18nProvider>
  );
}

async function renderSettings(settings: AppSettings = createDefaultSettings(NOW)) {
  settings.onboardingComplete = true;
  const deps = createFakeDependencies({ now: NOW, settings });
  const controller = createAppController(deps);
  await controller.hydrate();
  const user = userEvent.setup();
  render(
    <AppProvider controller={controller}>
      <LocalizedReminderSettings />
    </AppProvider>,
  );
  return { controller, deps, user };
}

async function openAddForm(
  user: ReturnType<typeof userEvent.setup>,
  labels: { button: string; group: string } = { button: '添加提醒', group: '添加自定义提醒' },
) {
  await user.click(screen.getByRole('button', { name: labels.button }));
  return screen.getByRole('group', { name: labels.group });
}

describe('custom reminder settings', () => {
  test('localizes English custom reminder add, edit, toggle, delete, dialogs, and errors without changing custom text', async () => {
    const settings = createDefaultSettings(NOW, 'en');
    const { controller, user } = await renderSettings(settings);
    const addForm = await openAddForm(user, { button: 'Add reminder', group: 'Add custom reminder' });

    await user.click(within(addForm).getByRole('button', { name: 'Save custom reminder' }));
    expect(within(addForm).getByRole('alert')).toHaveTextContent('Enter a reminder name');
    await user.type(within(addForm).getByLabelText('Reminder name'), '服药');
    await user.type(within(addForm).getByLabelText('Interval (minutes)'), '30');
    await user.click(within(addForm).getByLabelText('Enable now'));
    await user.click(within(addForm).getByRole('button', { name: 'Save custom reminder' }));

    const card = screen.getByRole('group', { name: '服药' });
    expect(within(card).getByLabelText('Reminder name')).toHaveValue('服药');
    await user.clear(within(card).getByLabelText('Interval (minutes)'));
    await user.type(within(card).getByLabelText('Interval (minutes)'), '45');
    await user.click(within(card).getByRole('button', { name: 'Save changes' }));
    expect(controller.getSnapshot().settings.reminders.find((item) => item.kind === 'custom'))
      .toMatchObject({ label: '服药', intervalMinutes: 45 });
    await user.click(within(card).getByRole('checkbox', { name: 'Enable 服药 reminder' }));
    expect(controller.getSnapshot().settings.reminders.find((item) => item.kind === 'custom'))
      .toMatchObject({ label: '服药', enabled: false });
    await user.click(within(card).getByRole('button', { name: 'Delete 服药' }));
    expect(screen.getByRole('dialog', { name: 'Delete 服药?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Delete reminder' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add reminder' })).toHaveFocus());
  });

  test.each([
    ['', '30', 'Enter a reminder name'],
    ['猫'.repeat(41), '30', 'Reminder names must be 40 characters or fewer'],
    ['服药', '1.5', 'Interval must be a whole number from 1 to 720'],
  ])('localizes English validation for label %j and interval %s', async (label, interval, message) => {
    const settings = createDefaultSettings(NOW, 'en');
    const { controller, user } = await renderSettings(settings);
    const save = vi.spyOn(controller, 'saveSettings');
    const form = await openAddForm(user, { button: 'Add reminder', group: 'Add custom reminder' });
    if (label !== '') await user.type(within(form).getByLabelText('Reminder name'), label);
    await user.type(within(form).getByLabelText('Interval (minutes)'), interval);

    await user.click(within(form).getByRole('button', { name: 'Save custom reminder' }));

    expect(within(form).getByRole('alert')).toHaveTextContent(message);
    expect(save).not.toHaveBeenCalled();
  });

  test('keeps add and delete dialogs and custom drafts intact across a language rerender', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '服药', 30, NOW, true));
    const { controller, user } = await renderSettings(settings);

    const addForm = await openAddForm(user);
    await user.type(within(addForm).getByLabelText('事项名称'), '复诊');
    await act(() => controller.saveSettings({ ...controller.getSnapshot().settings, locale: 'en' }));
    expect(screen.getByRole('group', { name: 'Add custom reminder' })).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Add custom reminder' })).getByLabelText('Reminder name')).toHaveValue('复诊');

    await user.click(within(screen.getByRole('group', { name: '服药' })).getByRole('button', { name: 'Delete 服药' }));
    expect(screen.getByRole('dialog', { name: 'Delete 服药?' })).toBeVisible();
    await act(() => controller.saveSettings({ ...controller.getSnapshot().settings, locale: 'zh-CN' }));
    expect(screen.getByRole('dialog', { name: '删除服药？' })).toBeVisible();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  test('adds, renames, disables, and deletes a custom reminder', async () => {
    const { controller, user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: '添加提醒' }));
    await user.type(screen.getByLabelText('事项名称'), '吃药');
    await user.type(screen.getByLabelText('循环间隔（分钟）'), '30');
    await user.click(screen.getByLabelText('立即启用'));
    await user.click(screen.getByRole('button', { name: '保存自定义提醒' }));
    expect(controller.getSnapshot().settings.reminders).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'custom', label: '吃药', enabled: true, intervalMinutes: 30 }),
    ]));

    const card = screen.getByRole('group', { name: '吃药' });
    await user.clear(within(card).getByLabelText('事项名称'));
    await user.type(within(card).getByLabelText('事项名称'), '服药');
    await user.click(within(card).getByRole('button', { name: '保存修改' }));
    expect(screen.getByRole('group', { name: '服药' })).toBeVisible();

    await user.click(within(screen.getByRole('group', { name: '服药' })).getByLabelText('启用服药提醒'));
    expect(controller.getSnapshot().settings.reminders.find((item) => item.kind === 'custom')).toMatchObject({ enabled: false, status: 'disabled' });

    await user.click(screen.getByRole('button', { name: '删除服药' }));
    expect(screen.getByRole('dialog', { name: '删除服药？' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(controller.getSnapshot().settings.reminders.every((item) => item.kind === 'preset')).toBe(true);
  });

  test.each([
    ['', '事项名称需要 1 到 40 个字符'],
    ['猫'.repeat(41), '事项名称需要 1 到 40 个字符'],
  ])('rejects invalid label %j', async (label, message) => {
    const { controller, user } = await renderSettings();
    const save = vi.spyOn(controller, 'saveSettings');
    const form = await openAddForm(user);
    if (label !== '') await user.type(within(form).getByLabelText('事项名称'), label);
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '30');
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(message);
    expect(save).not.toHaveBeenCalled();
  });

  test.each(['1.5', '0', '721'])('rejects invalid interval %s', async (interval) => {
    const { controller, user } = await renderSettings();
    const save = vi.spyOn(controller, 'saveSettings');
    const form = await openAddForm(user);
    await user.type(within(form).getByLabelText('事项名称'), '吃药');
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), interval);
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('循环间隔必须是 1 到 720 的整数');
    expect(save).not.toHaveBeenCalled();
  });

  test('retains add inputs when persistence fails', async () => {
    const { deps, user } = await renderSettings();
    deps.settings.saveFailure = true;
    const form = await openAddForm(user);
    await user.type(within(form).getByLabelText('事项名称'), '吃药');
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '30');
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('无法保存自定义提醒，请重试');
    expect(within(form).getByLabelText('事项名称')).toHaveValue('吃药');
    expect(within(form).getByLabelText('循环间隔（分钟）')).toHaveValue('30');
  });

  test('retries a temporarily applied add without creating a duplicate', async () => {
    const { controller, deps, user } = await renderSettings();
    deps.settings.saveFailure = true;
    const form = await openAddForm(user);
    await user.type(within(form).getByLabelText('事项名称'), '吃药');
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '30');
    await user.click(within(form).getByLabelText('立即启用'));
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    expect(controller.getSnapshot().settings.reminders.filter((item) => item.kind === 'custom')).toHaveLength(1);

    deps.settings.saveFailure = false;
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));

    const custom = controller.getSnapshot().settings.reminders.filter((item) => item.kind === 'custom');
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ label: '吃药', intervalMinutes: 30, enabled: true });
    expect(deps.settings.value?.reminders.filter((item) => item.kind === 'custom')).toEqual(custom);
    expect(screen.queryByRole('group', { name: '添加自定义提醒' })).not.toBeInTheDocument();
  });

  test('applies current add values when retrying a temporarily applied reminder', async () => {
    const { controller, deps, user } = await renderSettings();
    deps.settings.saveFailure = true;
    const form = await openAddForm(user);
    await user.type(within(form).getByLabelText('事项名称'), '吃药');
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '30');
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    const original = controller.getSnapshot().settings.reminders.find((item) => item.kind === 'custom')!;

    await user.clear(within(form).getByLabelText('事项名称'));
    await user.type(within(form).getByLabelText('事项名称'), '服药');
    await user.clear(within(form).getByLabelText('循环间隔（分钟）'));
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '60');
    await user.click(within(form).getByLabelText('立即启用'));
    deps.settings.saveFailure = false;
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));

    const custom = controller.getSnapshot().settings.reminders.filter((item) => item.kind === 'custom');
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({
      id: original.id,
      label: '服药',
      intervalMinutes: 60,
      enabled: true,
      status: 'scheduled',
      nextDueAt: NOW + 60 * 60_000,
      snoozedUntil: undefined,
    });
    expect(deps.settings.value?.reminders.filter((item) => item.kind === 'custom')).toEqual(custom);
  });

  test('abandons a failed add retry identity when the add form is canceled', async () => {
    const { deps, user } = await renderSettings();
    deps.settings.saveFailure = true;
    let form = await openAddForm(user);
    await user.type(within(form).getByLabelText('事项名称'), '吃药');
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '30');
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));
    await user.click(within(form).getByRole('button', { name: '取消添加' }));

    deps.settings.saveFailure = false;
    form = await openAddForm(user);
    await user.clear(within(form).getByLabelText('事项名称'));
    await user.type(within(form).getByLabelText('事项名称'), '复诊');
    await user.clear(within(form).getByLabelText('循环间隔（分钟）'));
    await user.type(within(form).getByLabelText('循环间隔（分钟）'), '60');
    await user.click(within(form).getByRole('button', { name: '保存自定义提醒' }));

    expect(deps.settings.value?.reminders.filter((item) => item.kind === 'custom').map((item) => item.label))
      .toEqual(['吃药', '复诊']);
  });

  test('retries the originally intended toggle after repository recovery', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push({
      ...createCustomReminder('custom-medicine', '吃药', 30, NOW, true),
      status: 'due',
      nextDueAt: NOW - 1,
    });
    const { controller, deps, user } = await renderSettings(settings);
    controller.getSnapshot().scheduler.dueQueue.push({ reminderId: 'custom-medicine', dueAt: NOW - 1 });
    deps.settings.saveFailure = true;
    await user.click(screen.getByLabelText('启用吃药提醒'));
    expect(controller.getSnapshot().settings.reminders.find((item) => item.id === 'custom-medicine'))
      .toMatchObject({ enabled: false, status: 'disabled' });

    deps.settings.saveFailure = false;
    await user.click(screen.getByLabelText('启用吃药提醒'));

    expect(controller.getSnapshot().settings.reminders.find((item) => item.id === 'custom-medicine'))
      .toMatchObject({ enabled: false, status: 'disabled' });
    expect(deps.settings.value?.reminders.find((item) => item.id === 'custom-medicine'))
      .toMatchObject({ enabled: false, status: 'disabled' });
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
  });

  test('retries a temporarily applied delete after repository recovery', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push({
      ...createCustomReminder('custom-medicine', '吃药', 30, NOW, true),
      status: 'due',
      nextDueAt: NOW - 1,
    });
    const { controller, deps, user } = await renderSettings(settings);
    controller.getSnapshot().scheduler.dueQueue.push({ reminderId: 'custom-medicine', dueAt: NOW - 1 });
    deps.settings.saveFailure = true;
    await user.click(screen.getByRole('button', { name: '删除吃药' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(controller.getSnapshot().settings.reminders.some((item) => item.id === 'custom-medicine')).toBe(false);

    deps.settings.saveFailure = false;
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(controller.getSnapshot().settings.reminders.some((item) => item.id === 'custom-medicine')).toBe(false);
    expect(deps.settings.value?.reminders.some((item) => item.id === 'custom-medicine')).toBe(false);
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
    expect(screen.queryByRole('dialog', { name: '删除吃药？' })).not.toBeInTheDocument();
  });

  test('keeps an edited draft after a failed save', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '吃药', 30, NOW, true));
    const { deps, user } = await renderSettings(settings);
    const card = screen.getByRole('group', { name: '吃药' });
    await user.clear(within(card).getByLabelText('事项名称'));
    await user.type(within(card).getByLabelText('事项名称'), '服药');
    deps.settings.saveFailure = true;
    await user.click(within(card).getByRole('button', { name: '保存修改' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('无法保存自定义提醒，请重试');
    expect(within(card).getByLabelText('事项名称')).toHaveValue('服药');
  });

  test('cancels deletion with Escape and returns focus to its trigger', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '吃药', 30, NOW, true));
    const { user } = await renderSettings(settings);
    const trigger = screen.getByRole('button', { name: '删除吃药' });
    await user.click(trigger);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '删除吃药？' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test('returns focus to add reminder after successfully deleting a reminder', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '吃药', 30, NOW, true));
    const { user } = await renderSettings(settings);
    const addReminder = screen.getByRole('button', { name: '添加提醒' });

    await user.click(screen.getByRole('button', { name: '删除吃药' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除吃药？' })).not.toBeInTheDocument());
    await waitFor(() => expect(addReminder).toHaveFocus());
  });

  test('falls back to add reminder when Escape closes a failed deletion whose trigger was removed', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '吃药', 30, NOW, true));
    const { deps, user } = await renderSettings(settings);
    const addReminder = screen.getByRole('button', { name: '添加提醒' });
    deps.settings.saveFailure = true;

    await user.click(screen.getByRole('button', { name: '删除吃药' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法删除自定义提醒，请重试');
    expect(screen.queryByRole('button', { name: '删除吃药' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除吃药？' })).not.toBeInTheDocument());
    await waitFor(() => expect(addReminder).toHaveFocus());
  });

  test('disabling a due reminder removes its stale due item', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push({
      ...createCustomReminder('custom-medicine', '吃药', 30, NOW, true),
      status: 'due',
      nextDueAt: NOW - 1,
    });
    const { controller, user } = await renderSettings(settings);
    controller.getSnapshot().scheduler.dueQueue.push({ reminderId: 'custom-medicine', dueAt: NOW - 1 });
    await user.click(screen.getByLabelText('启用吃药提醒'));
    expect(controller.getSnapshot().scheduler.dueQueue).toEqual([]);
  });

  test('disables add at the 20-item limit', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(...Array.from({ length: 20 }, (_, index) => (
      createCustomReminder(`custom-${index}`, `提醒 ${index + 1}`, 30, NOW, false)
    )));
    await renderSettings(settings);
    expect(screen.getByRole('button', { name: '添加提醒' })).toBeDisabled();
  });

  test('uses non-submit buttons for every custom mutation', async () => {
    const settings = createDefaultSettings(NOW);
    settings.reminders.push(createCustomReminder('custom-medicine', '吃药', 30, NOW, true));
    const { user } = await renderSettings(settings);
    await openAddForm(user);
    screen.getAllByRole('button')
      .filter((button) => /添加提醒|取消添加|保存自定义提醒|保存修改|删除吃药/.test(button.textContent ?? ''))
      .forEach((button) => expect(button).toHaveAttribute('type', 'button'));

    fireEvent.click(screen.getByRole('button', { name: '删除吃药' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveAttribute('type', 'button');
  });
});
