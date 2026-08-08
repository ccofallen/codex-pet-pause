import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { Reminder } from '../../features/reminders/domain/types';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import { AndroidOverlayApp } from './AndroidOverlayApp';
import {
  AndroidOverlayStage,
  type AndroidOverlayMessageHost,
} from './AndroidOverlayStage';

const NOW = Date.UTC(2026, 7, 8, 9);

function dueReminder(id: 'lookAway' | 'drinkWater' | 'standUp', dueAt: number): Reminder {
  return {
    id,
    kind: 'preset',
    type: id,
    enabled: true,
    intervalMinutes: 20,
    nextDueAt: dueAt,
    status: 'due',
    ...(id === 'lookAway' ? { optionalActionDurationSeconds: 20 } : {}),
  };
}

function snapshotFor(
  reminders: Reminder[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): AndroidHostSnapshot {
  const settings = createDefaultSettings(NOW, locale);
  settings.onboardingComplete = true;
  settings.reminders = [
    ...reminders,
    ...settings.reminders.filter((candidate) => !reminders.some(({ id }) => id === candidate.id)),
  ];
  return {
    schemaVersion: 1,
    settingsJson: JSON.stringify(settings),
    historyJson: [],
    pets: [],
    overlay: { xRatio: 0.8, yRatio: 0.7 },
  };
}

function renderBubble(
  snapshot = snapshotFor([
    dueReminder('lookAway', NOW + 2_000),
    dueReminder('drinkWater', NOW + 1_000),
  ]),
) {
  const postMessage = vi.fn<AndroidOverlayMessageHost['postMessage']>();
  const host = { postMessage };
  const view = render(
    <AndroidOverlayStage snapshot={snapshot} host={host} bubbleOpen />,
  );
  return {
    ...view,
    postMessage,
    rerenderSnapshot(next: AndroidHostSnapshot) {
      view.rerender(<AndroidOverlayStage snapshot={next} host={host} bubbleOpen />);
    },
  };
}

afterEach(() => {
  delete window.AndroidOverlay;
  vi.restoreAllMocks();
});

test('shows one deterministically ordered reminder with bilingual primary actions', () => {
  renderBubble();

  const bubble = screen.getByRole('dialog', { name: '喝水提醒' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(bubble).getByText('陪我去喝口水吧？')).toBeVisible();
  expect(within(bubble).getByRole('button', { name: '现在做' })).toBeVisible();
  expect(within(bubble).getByRole('button', { name: '稍后提醒' })).toBeVisible();
  expect(within(bubble).getByRole('button', { name: '跳过' })).toBeVisible();
});

test('completion has no third close layer and advances directly or disappears', async () => {
  const user = userEvent.setup();
  const view = renderBubble();

  await user.click(screen.getByRole('button', { name: '现在做' }));
  expect(screen.getByRole('button', { name: '完成了' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /关闭|close/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '完成了' }));
  expect(view.postMessage).toHaveBeenLastCalledWith({
    type: 'reminder-action',
    action: 'complete',
    reminderId: 'drinkWater',
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  view.rerenderSnapshot(snapshotFor([dueReminder('lookAway', NOW + 2_000)]));
  expect(screen.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  expect(screen.getByRole('button', { name: '现在做' })).toBeVisible();

  view.rerenderSnapshot(snapshotFor([]));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('snooze and skip send the current occurrence through the typed native bridge', async () => {
  const user = userEvent.setup();
  const snoozeView = renderBubble(snapshotFor([dueReminder('lookAway', NOW)]));

  await user.click(screen.getByRole('button', { name: '稍后提醒' }));
  expect(screen.getByRole('group', { name: '稍后时间' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '10 分钟' }));
  expect(snoozeView.postMessage).toHaveBeenLastCalledWith({
    type: 'reminder-action',
    action: 'snooze',
    reminderId: 'lookAway',
    snoozeMinutes: 10,
  });
  snoozeView.unmount();

  const skipView = renderBubble(snapshotFor([dueReminder('standUp', NOW)]));
  await user.click(screen.getByRole('button', { name: '跳过' }));
  expect(skipView.postMessage).toHaveBeenLastCalledWith({
    type: 'reminder-action',
    action: 'skip',
    reminderId: 'standUp',
  });
});

test('keeps English primary actions content-sized and reports every intrinsic size change', async () => {
  const user = userEvent.setup();
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  bounds.mockReturnValue({
    x: 0,
    y: 0,
    width: 304,
    height: 248,
    top: 0,
    right: 304,
    bottom: 248,
    left: 0,
    toJSON: () => undefined,
  });
  const view = renderBubble(snapshotFor([dueReminder('lookAway', NOW)], 'en'));

  const bubble = screen.getByRole('dialog', { name: 'Look into the distance reminder' });
  expect(within(bubble).getByRole('button', { name: 'Do it now' })).toBeVisible();
  expect(within(bubble).getByRole('button', { name: 'Remind me later' })).toBeVisible();
  expect(within(bubble).getByRole('button', { name: 'Skip' })).toBeVisible();
  expect(view.postMessage).toHaveBeenCalledWith({
    type: 'bubble-size-changed',
    widthDp: 304,
    heightDp: 248,
  });

  bounds.mockReturnValue({
    x: 0,
    y: 0,
    width: 304,
    height: 292,
    top: 0,
    right: 304,
    bottom: 292,
    left: 0,
    toJSON: () => undefined,
  });
  await user.click(within(bubble).getByRole('button', { name: 'Do it now' }));

  expect(view.postMessage).toHaveBeenCalledWith({
    type: 'bubble-size-changed',
    widthDp: 304,
    heightDp: 292,
  });
});

test('native show and close events control the existing overlay renderer', () => {
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };
  render(<AndroidOverlayApp />);

  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', {
    detail: { type: 'state-changed', snapshot: snapshotFor([dueReminder('lookAway', NOW)]) },
  })));
  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', {
    detail: { type: 'show-reminder' },
  })));
  expect(screen.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();

  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', {
    detail: { type: 'close-bubble' },
  })));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
