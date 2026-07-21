import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { createAppController } from '../../app/appController';
import { AppProvider } from '../../app/AppProvider';
import { createFakeDependencies } from '../../test/fakes';
import { createCustomReminder } from '../reminders/domain/scheduler';
import { OnboardingFlow } from './OnboardingFlow';
import { I18nProvider } from '../../i18n/I18nProvider';

function onboardingView(controller: ReturnType<typeof createAppController>, locale: 'zh-CN' | 'en') {
  return (
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><OnboardingFlow /></I18nProvider>
    </AppProvider>
  );
}

function renderOnboarding(
  notificationStatus: 'granted' | 'denied' | 'unavailable' = 'granted',
  configure?: (dependencies: ReturnType<typeof createFakeDependencies>) => void,
  locale: 'zh-CN' | 'en' = 'zh-CN',
) {
  const dependencies = createFakeDependencies({ now: 1_000 });
  dependencies.notifications.requestedPermission = notificationStatus;
  configure?.(dependencies);
  const controller = createAppController(dependencies);
  const view = render(onboardingView(controller, locale));
  return { controller, dependencies, user: userEvent.setup(), view };
}

async function goToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '下一步' }));
  await user.click(screen.getByRole('button', { name: '下一步' }));
  await user.click(screen.getByRole('button', { name: '下一步' }));
}

describe('OnboardingFlow', () => {
  test('uses Codex Pet Pause product branding', () => {
    renderOnboarding();

    expect(screen.getByRole('heading', { name: '欢迎来到 Codex Pet Pause' })).toBeVisible();
  });

  test('presents English onboarding and preserves drafts and step when locale changes', async () => {
    const { controller, user, view } = renderOnboarding('granted', undefined, 'en');
    expect(screen.getByRole('heading', { name: 'Welcome to Codex Pet Pause' })).toBeVisible();
    await user.clear(screen.getByLabelText('Cat name'));
    await user.type(screen.getByLabelText('Cat name'), 'Luna');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByLabelText('Enable Drink water reminder'));
    await user.clear(screen.getByLabelText('Drink water interval (minutes)'));
    await user.type(screen.getByLabelText('Drink water interval (minutes)'), '30');

    view.rerender(onboardingView(controller, 'zh-CN'));

    expect(screen.getByRole('progressbar', { name: '设置进度' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByDisplayValue('Luna')).toBeInTheDocument();
    expect(screen.getByLabelText('喝水间隔（分钟）')).toHaveValue(30);
  });

  test('requires a valid cat name and at least one enabled reminder', async () => {
    const { user } = renderOnboarding();
    await user.clear(screen.getByLabelText('猫咪名字'));
    await goToReview(user);
    await user.click(screen.getByRole('button', { name: '开始陪伴' }));

    expect(screen.getByText('请输入 1–20 个字符的名字')).toBeVisible();
    expect(screen.getByText('请至少启用一种提醒')).toBeVisible();
    expect(screen.getByLabelText('猫咪名字')).not.toHaveAttribute('aria-describedby');

    await user.click(screen.getByRole('button', { name: '上一步' }));
    await user.click(screen.getByRole('button', { name: '上一步' }));
    await user.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByLabelText('猫咪名字')).toHaveAttribute('aria-describedby', 'cat-name-error');
    expect(screen.getByText('请输入 1–20 个字符的名字')).toBeVisible();
  });

  test('requires enabled reminder intervals to be integers from 1 through 720', async () => {
    const { user } = renderOnboarding();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByLabelText('启用喝水提醒'));
    await user.clear(screen.getByLabelText('喝水间隔（分钟）'));
    await user.type(screen.getByLabelText('喝水间隔（分钟）'), '1.5');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '开始陪伴' }));

    expect(screen.getByText('提醒间隔必须是 1–720 之间的整数')).toBeVisible();
  });

  test('only presents preset reminders during onboarding', async () => {
    const { controller, user } = renderOnboarding('granted', (dependencies) => {
      dependencies.settings.value!.reminders.push(
        createCustomReminder('custom-medicine', '吃药', 30, 1_000, true),
      );
    });
    await vi.waitFor(() => expect(controller.getSnapshot().settings.reminders).toHaveLength(5));

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.queryByText('吃药')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('尚未启用')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '开始陪伴' }));
    expect(screen.getByText('请至少启用一种提醒')).toBeVisible();
  });

  test('moves focus to each fieldset legend after forward and backward navigation', async () => {
    const { user } = renderOnboarding();

    expect(screen.getByRole('progressbar', { name: '设置进度' })).toHaveAttribute('aria-valuenow', '1');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('progressbar', { name: '设置进度' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('第 2 步：设置提醒')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByText('第 1 步：认识猫咪')).toHaveFocus();
  });

  test('requests notifications only after the explicit button click and does not block denied users', async () => {
    const { dependencies, user } = renderOnboarding('denied');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByLabelText('启用喝水提醒'));
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(dependencies.notifications.requests).toBe(0);
    await user.click(screen.getByRole('button', { name: '启用系统通知' }));
    expect(dependencies.notifications.requests).toBe(1);
    expect(screen.getByText('系统通知已关闭，后台提醒可靠性会降低')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '开始陪伴' }));
    expect(dependencies.settings.value?.onboardingComplete).toBe(true);
  });

  test('shows unavailable notification guidance without blocking completion', async () => {
    const { user } = renderOnboarding('unavailable');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByLabelText('启用喝水提醒'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '启用系统通知' }));

    expect(screen.getByText('此浏览器不支持系统通知，仍可使用网页内提醒')).toBeVisible();
  });

  test('saves the trimmed name-only cat, reminder, and sound choices', async () => {
    const { dependencies, user } = renderOnboarding();
    const name = screen.getByLabelText('猫咪名字');
    expect(screen.getByLabelText('猫咪预览')).toContainElement(screen.getByTestId('cat-sprite'));
    for (const label of ['姜黄色', '虎斑', '明亮眼', '折耳', '直尾', '围巾']) {
      expect(screen.queryByRole('radio', { name: label })).not.toBeInTheDocument();
    }
    await user.clear(name);
    await user.type(name, '  团子  ');

    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByLabelText('启用喝水提醒'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('radio', { name: '夜间' }));
    await user.click(screen.getByLabelText('启用提示音'));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText(/团子/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '开始陪伴' }));

    expect(dependencies.settings.value).toMatchObject({
      onboardingComplete: true,
      theme: 'dark',
      soundEnabled: true,
      cat: { name: '团子' },
    });
    expect(dependencies.settings.value?.reminders.find(({ id }) => id === 'drinkWater'))
      .toMatchObject({ enabled: true, intervalMinutes: 45 });
  });
});
