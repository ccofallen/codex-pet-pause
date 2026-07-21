import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { AppProvider } from '../../../app/AppProvider';
import { createAppController } from '../../../app/appController';
import { createFakeDependencies } from '../../../test/fakes';
import { createCustomReminder } from '../domain/scheduler';
import { ActionCard } from './ActionCard';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Reminder } from '../domain/types';

const NOW = Date.UTC(2026, 6, 11, 9);

function actionView(
  controller: ReturnType<typeof createAppController>,
  reminder: Reminder,
  locale: 'zh-CN' | 'en',
) {
  return (
    <AppProvider controller={controller}>
      <I18nProvider locale={locale}><ActionCard reminder={reminder} /></I18nProvider>
    </AppProvider>
  );
}

test('presents custom reminder names without a countdown', () => {
  const reminder = createCustomReminder('custom-medicine', '吃药', 30, NOW, true);
  const controller = createAppController(createFakeDependencies({ now: NOW }));
  controller.hydrate = vi.fn(async () => undefined);
  controller.reconcileNow = vi.fn(async () => undefined);
  render(actionView(controller, reminder, 'zh-CN'));
  expect(screen.getByText('该做“吃药”了，按舒服的节奏来。')).toBeVisible();
  expect(screen.queryByRole('button', { name: /开始.*计时/ })).not.toBeInTheDocument();
});

test('localizes the countdown and preserves it across locale changes', () => {
  vi.useFakeTimers();
  const reminder: Reminder = {
    id: 'lookAway', kind: 'preset', type: 'lookAway', enabled: true,
    intervalMinutes: 20, nextDueAt: NOW, status: 'due', optionalActionDurationSeconds: 20,
  };
  const controller = createAppController(createFakeDependencies({ now: NOW }));
  controller.hydrate = vi.fn(async () => undefined);
  controller.reconcileNow = vi.fn(async () => undefined);
  const view = render(actionView(controller, reminder, 'en'));

  fireEvent.click(screen.getByRole('button', { name: 'Start 20-second timer' }));
  expect(screen.getByText('20 seconds remaining')).toBeVisible();
  act(() => vi.advanceTimersByTime(1_000));
  view.rerender(actionView(controller, reminder, 'zh-CN'));
  expect(screen.getByText('剩余 19 秒')).toBeVisible();
  vi.useRealTimers();
});

test('restores a running countdown from its original deadline after remounting', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const reminder: Reminder = {
    id: 'lookAway', kind: 'preset', type: 'lookAway', enabled: true,
    intervalMinutes: 20, nextDueAt: NOW, status: 'due', optionalActionDurationSeconds: 20,
  };
  const controller = createAppController(createFakeDependencies({ now: NOW }));
  controller.hydrate = vi.fn(async () => undefined);
  controller.reconcileNow = vi.fn(async () => undefined);
  let deadline: number | undefined;
  const first = render(
    <AppProvider controller={controller}>
      <I18nProvider locale="en">
        <ActionCard reminder={reminder} onCountdownStarted={(value) => { deadline = value; }} />
      </I18nProvider>
    </AppProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Start 20-second timer' }));
  first.unmount();
  act(() => vi.advanceTimersByTime(1_000));
  render(
    <AppProvider controller={controller}>
      <I18nProvider locale="zh-CN">
        <ActionCard reminder={reminder} countdownEndsAt={deadline} />
      </I18nProvider>
    </AppProvider>,
  );

  expect(screen.getByText('剩余 19 秒')).toBeVisible();
  vi.useRealTimers();
});
