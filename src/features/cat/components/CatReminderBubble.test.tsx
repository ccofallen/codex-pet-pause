import { createRef, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppProvider } from '../../../app/AppProvider';
import { createDefaultSettings } from '../../../app/defaults';
import type { AppController } from '../../../app/appController';
import type { AppSnapshot } from '../../../app/model';
import type { PresetReminder, PresetReminderType, Reminder } from '../../reminders/domain/types';
import { createCustomReminder } from '../../reminders/domain/scheduler';
import { CatReminderBubble, type CatAnchor } from './CatReminderBubble';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Locale } from '../../../i18n/types';

const NOW = new Date('2026-07-11T09:00:00Z').getTime();
const ANCHOR: CatAnchor = { x: 836, y: 96, width: 140, height: 152 };
const GLOBAL_CSS = readFileSync('src/styles/global.css', 'utf8');

function reminder(type: PresetReminderType, duration?: number): PresetReminder {
  return {
    id: type,
    kind: 'preset',
    type,
    enabled: true,
    intervalMinutes: 20,
    nextDueAt: NOW,
    status: 'due',
    ...(duration === undefined ? {} : { optionalActionDurationSeconds: duration }),
  };
}

function dueController(
  reminders: Reminder[] = [reminder('lookAway', 20), reminder('drinkWater')],
): AppController {
  const settings = createDefaultSettings(NOW);
  settings.reminders = reminders;
  const snapshot: AppSnapshot = {
    ready: true,
    settings,
    scheduler: {
      reminders,
      dueQueue: reminders.map((item, index) => ({
        reminderId: item.id,
        dueAt: NOW + index,
      })),
    },
    storageMode: 'persistent',
    notificationStatus: 'default',
    pets: [],
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => undefined),
    hydrate: vi.fn(async () => undefined),
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

function statefulQueueController(
  reminders: Reminder[] = [reminder('lookAway', 20), reminder('drinkWater')],
): AppController {
  const controller = dueController(reminders);
  let snapshot = controller.getSnapshot();
  const listeners = new Set<() => void>();
  const remove = (id: string) => {
    snapshot = {
      ...snapshot,
      scheduler: {
        ...snapshot.scheduler,
        dueQueue: snapshot.scheduler.dueQueue.filter((item) => item.reminderId !== id),
      },
    };
    listeners.forEach((listener) => listener());
  };
  controller.getSnapshot = () => snapshot;
  controller.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  controller.complete = vi.fn(async (id: string) => remove(id));
  controller.snooze = vi.fn(async (id: string) => remove(id));
  controller.skip = vi.fn(async (id: string) => remove(id));
  return controller;
}

interface RenderBubbleOptions {
  open?: boolean;
  anchor?: CatAnchor;
  controller?: AppController;
  onRequestClose?: () => void;
  onLayout?: () => void;
  onActionStarted?: () => void;
  onSnoozed?: () => void;
  onSkipped?: () => void;
  locale?: Locale;
}

function LayoutObserver({ onLayout }: { onLayout: () => void }) {
  useLayoutEffect(onLayout);
  return null;
}

function renderBubble({
  open = true,
  anchor = ANCHOR,
  controller = dueController(),
  onRequestClose = vi.fn(),
  onLayout,
  onActionStarted,
  onSnoozed,
  onSkipped,
  locale = 'zh-CN',
}: RenderBubbleOptions = {}) {
  const returnFocusRef = createRef<HTMLButtonElement>();
  const ui = (bubbleOpen: boolean, bubbleAnchor = anchor, bubbleLocale = locale) => (
    <AppProvider controller={controller}>
      <I18nProvider locale={bubbleLocale}>
        <div className="app-shell">
          <main data-testid="bubble-shell-main" />
          <aside data-testid="bubble-prior-inert" inert />
          <button ref={returnFocusRef} type="button">猫咪</button>
          <CatReminderBubble
            open={bubbleOpen}
            anchor={bubbleAnchor}
            returnFocusRef={returnFocusRef}
            onRequestClose={onRequestClose}
            {...(onActionStarted === undefined ? {} : { onActionStarted })}
            {...(onSnoozed === undefined ? {} : { onSnoozed })}
            {...(onSkipped === undefined ? {} : { onSkipped })}
          />
          {onLayout !== undefined && <LayoutObserver onLayout={onLayout} />}
        </div>
      </I18nProvider>
    </AppProvider>
  );
  const result = render(ui(open));
  return {
    ...result,
    controller,
    onRequestClose,
    returnFocusRef,
    rerenderBubble: (
      bubbleOpen: boolean,
      bubbleAnchor = anchor,
      bubbleLocale = locale,
    ) => result.rerender(ui(bubbleOpen, bubbleAnchor, bubbleLocale)),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('renders only when controlled open and focuses the first action', () => {
  const { rerenderBubble } = renderBubble({ open: false });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  rerenderBubble(true);

  expect(screen.getByRole('dialog')).toHaveAccessibleName('目视远方提醒');
  expect(screen.getByText('看屏幕很久啦，要不要看看远处？')).toBeVisible();
  expect(screen.getByRole('button', { name: '现在做' })).toHaveFocus();
});

test('restores focus when the controlled bubble changes from open to closed', () => {
  const { rerenderBubble } = renderBubble();

  expect(screen.getByRole('button', { name: '现在做' })).toHaveFocus();
  rerenderBubble(false);

  expect(screen.getByRole('button', { name: '猫咪' })).toHaveFocus();
});

test('inerts every direct shell surface except the cat and bubble, then restores prior and dynamic state', async () => {
  const { rerenderBubble } = renderBubble();
  const main = screen.getByTestId('bubble-shell-main');
  const priorInert = screen.getByTestId('bubble-prior-inert');
  const cat = screen.getByRole('button', { name: '猫咪' });
  const dialog = screen.getByRole('dialog');
  const shell = main.parentElement!;

  expect(main).toHaveAttribute('inert');
  expect(priorInert).toHaveAttribute('inert');
  expect(cat).not.toHaveAttribute('inert');
  expect(dialog).not.toHaveAttribute('inert');

  const lateSurface = document.createElement('nav');
  shell.append(lateSurface);
  await waitFor(() => expect(lateSurface).toHaveAttribute('inert'));

  rerenderBubble(false);

  expect(main).not.toHaveAttribute('inert');
  expect(priorInert).toHaveAttribute('inert');
  expect(lateSurface).not.toHaveAttribute('inert');
  lateSurface.remove();
});

describe.each<[PresetReminderType, string]>([
  ['lookAway', '看屏幕很久啦，要不要看看远处？'],
  ['drinkWater', '陪我去喝口水吧？'],
  ['standUp', '起来伸个懒腰怎么样？'],
  ['takeBreak', '休息一会儿，我在这里等你。'],
])('cat reminder copy for %s', (type, copy) => {
  test('uses the exact cat-voiced message', () => {
    renderBubble({ controller: dueController([reminder(type)]) });

    expect(screen.getByText(copy)).toBeVisible();
  });
});

test('renders a due custom reminder with its label and the shared due actions', () => {
  const custom = { ...createCustomReminder('custom-medicine', '吃药', 30, NOW, true), status: 'due' as const };
  renderBubble({ controller: dueController([custom]) });

  expect(screen.getByRole('dialog')).toHaveAccessibleName('吃药提醒');
  expect(screen.getByText('我来提醒你：吃药。')).toBeVisible();
  expect(screen.getByRole('button', { name: '现在做' })).toBeVisible();
  expect(screen.getByRole('button', { name: '稍后提醒' })).toBeVisible();
  expect(screen.getByRole('button', { name: '跳过' })).toBeVisible();
});

test('localizes due actions and preserves custom reminder text byte-for-visible-text', async () => {
  const user = userEvent.setup();
  const custom = { ...createCustomReminder('custom-medicine', '服药', 30, NOW, true), status: 'due' as const };
  renderBubble({ controller: dueController([custom]), locale: 'en' });

  expect(screen.getByRole('dialog')).toHaveAccessibleName('服药 reminder');
  expect(screen.getByText('A little reminder from me: 服药.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Do it now' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Remind me later' }));
  expect(screen.getByRole('group', { name: 'Remind me later options' })).toBeVisible();
  expect(screen.getByRole('button', { name: '10 minutes' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Skip' })).toBeVisible();
});

test('keeps an open reminder and focused action across a locale rerender', () => {
  const baseController = dueController();
  let snapshot = baseController.getSnapshot();
  const listeners = new Set<() => void>();
  const controller: AppController = {
    ...baseController,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const { rerenderBubble } = renderBubble({ controller });
  const focusedAction = screen.getByRole('button', { name: '跳过' });
  focusedAction.focus();
  expect(focusedAction).toHaveFocus();

  act(() => {
    snapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, locale: 'en' },
      scheduler: {
        ...snapshot.scheduler,
        reminders: snapshot.scheduler.reminders.map((item) => ({ ...item })),
      },
    };
    listeners.forEach((listener) => listener());
    rerenderBubble(true, ANCHOR, 'en');
  });

  expect(screen.getByRole('dialog')).toHaveAccessibleName('Look into the distance reminder');
  expect(screen.getByRole('button', { name: 'Skip' })).toBe(focusedAction);
  expect(focusedAction).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
  const fiveMinutes = screen.getByRole('button', { name: '5 minutes' });
  fiveMinutes.focus();
  act(() => {
    snapshot = {
      ...snapshot,
      settings: { ...snapshot.settings, locale: 'zh-CN' },
      scheduler: {
        ...snapshot.scheduler,
        reminders: snapshot.scheduler.reminders.map((item) => ({ ...item })),
      },
    };
    listeners.forEach((listener) => listener());
    rerenderBubble(true, ANCHOR, 'zh-CN');
  });
  expect(screen.getByRole('button', { name: '5 分钟' })).toBe(fiveMinutes);
  expect(fiveMinutes).toHaveFocus();
});

test('positions the measured bubble beside its cat anchor', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    top: 0,
    right: 320,
    bottom: 240,
    left: 0,
    toJSON: () => undefined,
  });

  renderBubble();

  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('data-side', 'left');
  expect(dialog).toHaveStyle({ position: 'fixed', left: '504px', top: '52px' });
});

test('keeps the reminder bubble reachable in a short landscape viewport', () => {
  const contentStart = GLOBAL_CSS.indexOf('.cat-reminder-bubble-content {');
  const contentEnd = GLOBAL_CSS.indexOf('}', contentStart);
  const contentCss = GLOBAL_CSS.slice(contentStart, contentEnd);

  expect(contentCss).toMatch(/max-height:\s*calc\(100dvh\s*-\s*24px\s*-\s*2\.2rem\)/);
  expect(contentCss).toMatch(/overflow:\s*auto/);
});

test('repositions the bubble when the viewport resizes', () => {
  const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_024);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    top: 0,
    right: 320,
    bottom: 240,
    left: 0,
    toJSON: () => undefined,
  });
  renderBubble();
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveStyle({ left: '504px', top: '52px' });

  viewportWidth.mockReturnValue(600);
  fireEvent(window, new Event('resize'));

  expect(dialog).toHaveStyle({ left: '280px', top: '52px' });
});

test('repositions after intrinsic size changes and disconnects its observer', () => {
  let bubbleSize = { width: 200, height: 100 };
  let resizeCallback: ResizeObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }

    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    width: bubbleSize.width,
    height: bubbleSize.height,
    top: 0,
    right: bubbleSize.width,
    bottom: bubbleSize.height,
    left: 0,
    toJSON: () => undefined,
  }));
  const { unmount } = renderBubble({
    anchor: { x: 430, y: 274, width: 140, height: 152 },
  });
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('data-side', 'top');
  expect(observe).toHaveBeenCalledWith(dialog);

  bubbleSize = { width: 500, height: 400 };
  act(() => resizeCallback?.([], {} as ResizeObserver));

  expect(dialog).toHaveAttribute('data-side', 'right');
  expect(dialog).toHaveStyle({ left: '524px', top: '150px' });

  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test('Escape requests close, returns focus, and does not change the queue', async () => {
  const user = userEvent.setup();
  const onRequestClose = vi.fn();
  const { controller } = renderBubble({ onRequestClose });

  await user.keyboard('{Escape}');

  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '猫咪' })).toHaveFocus();
  expect(controller.skip).not.toHaveBeenCalled();
  expect(controller.complete).not.toHaveBeenCalled();
  expect(controller.snooze).not.toHaveBeenCalled();
});

test('traps keyboard focus inside the visible bubble', async () => {
  const user = userEvent.setup();
  renderBubble();
  const now = screen.getByRole('button', { name: '现在做' });
  const skip = screen.getByRole('button', { name: '跳过' });

  expect(now).toHaveFocus();
  await user.tab({ shift: true });
  expect(skip).toHaveFocus();
  await user.tab();
  expect(now).toHaveFocus();
});

test('offers snooze choices, focuses 10 minutes, and snoozes the current reminder', async () => {
  const user = userEvent.setup();
  const { controller } = renderBubble();

  await user.click(screen.getByRole('button', { name: '稍后提醒' }));
  expect(screen.getByRole('button', { name: '10 分钟' })).toHaveFocus();

  await user.click(screen.getByRole('button', { name: '10 分钟' }));
  expect(controller.snooze).toHaveBeenCalledWith('lookAway', 10);
});

test('reports action, chosen snooze, and skip synchronously and exactly once', async () => {
  const user = userEvent.setup();
  const actionController = dueController();
  const actionObservations: string[] = [];
  const onActionStarted = vi.fn(() => {
    actionObservations.push(screen.queryByRole('button', { name: '完成了' }) === null ? 'before' : 'after');
  });
  const actionView = renderBubble({ controller: actionController, onActionStarted });

  await user.click(screen.getByRole('button', { name: '现在做' }));
  expect(onActionStarted).toHaveBeenCalledTimes(1);
  expect(actionObservations).toEqual(['before']);
  actionView.unmount();

  const snoozeController = dueController();
  const snoozeObservations: number[] = [];
  const onSnoozed = vi.fn(() => {
    snoozeObservations.push(vi.mocked(snoozeController.snooze).mock.calls.length);
  });
  const snoozeView = renderBubble({ controller: snoozeController, onSnoozed });
  await user.click(screen.getByRole('button', { name: '稍后提醒' }));
  expect(onSnoozed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '5 分钟' }));
  expect(onSnoozed).toHaveBeenCalledTimes(1);
  expect(snoozeObservations).toEqual([0]);
  snoozeView.unmount();

  const skipController = dueController();
  const skipObservations: number[] = [];
  const onSkipped = vi.fn(() => {
    skipObservations.push(vi.mocked(skipController.skip).mock.calls.length);
  });
  renderBubble({ controller: skipController, onSkipped });
  await user.click(screen.getByRole('button', { name: '跳过' }));
  expect(onSkipped).toHaveBeenCalledTimes(1);
  expect(skipObservations).toEqual([0]);
});

test.each([
  ['skip', '跳过'],
  ['snooze', '10 分钟'],
] as const)('%s advances immediately to the next queued reminder', async (command, controlName) => {
  const user = userEvent.setup();
  const controller = statefulQueueController();
  renderBubble({ controller });

  expect(screen.getByText('第 1 / 2 项')).toBeVisible();

  if (command === 'snooze') {
    await user.click(screen.getByRole('button', { name: '稍后提醒' }));
  }
  await user.click(screen.getByRole('button', { name: controlName }));

  expect(screen.getByRole('dialog')).toHaveAccessibleName('喝水提醒');
  expect(screen.getByText('陪我去喝口水吧？')).toBeVisible();
  expect(screen.getByText('第 2 / 2 项')).toBeVisible();
  expect(screen.getByRole('button', { name: '现在做' })).toHaveFocus();
});

test.each([
  ['skip', '跳过'],
  ['snooze', '10 分钟'],
] as const)('%s returns focus when it removes the last queued reminder', async (command, controlName) => {
  const user = userEvent.setup();
  const controller = statefulQueueController([reminder('lookAway', 20)]);
  const onRequestClose = vi.fn();
  renderBubble({ controller, onRequestClose });

  if (command === 'snooze') {
    await user.click(screen.getByRole('button', { name: '稍后提醒' }));
  }
  await user.click(screen.getByRole('button', { name: controlName }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '猫咪' })).toHaveFocus();
  expect(onRequestClose).not.toHaveBeenCalled();
});

test('does not expose stale queue progress when a closed session reopens', async () => {
  const user = userEvent.setup();
  const controller = statefulQueueController();
  const progressAtLayout: Array<string | null> = [];
  const { rerenderBubble } = renderBubble({
    controller,
    onLayout: () => {
      progressAtLayout.push(document.querySelector('.reminder-queue-progress')?.textContent ?? null);
    },
  });
  await user.click(screen.getByRole('button', { name: '跳过' }));
  expect(screen.getByText('第 2 / 2 项')).toBeVisible();

  rerenderBubble(false);
  progressAtLayout.length = 0;
  rerenderBubble(true);

  expect(progressAtLayout[0]).toBeNull();
  expect(screen.queryByText('第 2 / 2 项')).not.toBeInTheDocument();
});

test('moves focus into the action card and keeps completion single-flight', async () => {
  let finishComplete!: () => void;
  const controller = dueController();
  controller.complete = vi.fn(() => new Promise<void>((resolve) => { finishComplete = resolve; }));
  renderBubble({ controller });
  fireEvent.click(screen.getByRole('button', { name: '现在做' }));

  expect(screen.getByRole('button', { name: '开始 20 秒计时' })).toHaveFocus();
  const complete = screen.getByRole('button', { name: '完成了' });
  fireEvent.click(complete);
  fireEvent.click(complete);

  expect(controller.complete).toHaveBeenCalledTimes(1);
  expect(complete).toBeDisabled();
  await act(async () => finishComplete());
  expect(await screen.findByRole('status')).toHaveFocus();
});

test('retains the focused completion confirmation after the queue advances', async () => {
  const user = userEvent.setup();
  const controller = statefulQueueController();
  renderBubble({ controller });
  expect(screen.getByText('第 1 / 2 项')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '现在做' }));

  await user.click(screen.getByRole('button', { name: '完成了' }));

  const confirmation = await screen.findByRole('status');
  expect(confirmation).toHaveTextContent('目视远方已完成');
  expect(confirmation).toHaveFocus();
  expect(screen.getByText('第 1 / 2 项')).toBeVisible();
  expect(controller.getSnapshot().scheduler.dueQueue[0]?.reminderId).toBe('drinkWater');

  await user.click(screen.getByRole('button', { name: '继续下一项' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('喝水提醒');
  expect(screen.getByText('第 2 / 2 项')).toBeVisible();
  expect(screen.getByRole('button', { name: '现在做' })).toHaveFocus();
});

test('closes an empty completion confirmation only through its explicit control', async () => {
  const user = userEvent.setup();
  const onRequestClose = vi.fn();
  const controller = statefulQueueController([reminder('lookAway', 20)]);
  renderBubble({ controller, onRequestClose });
  await user.click(screen.getByRole('button', { name: '现在做' }));
  await user.click(screen.getByRole('button', { name: '完成了' }));

  expect(await screen.findByRole('status')).toHaveFocus();
  expect(onRequestClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '关闭' }));

  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '猫咪' })).toHaveFocus();
});

test('keeps the optional countdown inside the bubble', () => {
  vi.useFakeTimers();
  renderBubble();
  fireEvent.click(screen.getByRole('button', { name: '现在做' }));

  expect(screen.getByText('把视线移到远处，让眼睛轻松一下。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始 20 秒计时' }));
  expect(screen.getByText('剩余 20 秒')).toBeInTheDocument();
  for (let second = 0; second < 20; second += 1) {
    act(() => vi.advanceTimersByTime(1_000));
  }
  expect(screen.getByText('计时结束')).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});

test('does not offer a countdown for drink water even when persisted data includes a duration', async () => {
  const user = userEvent.setup();
  renderBubble({ controller: dueController([reminder('drinkWater', 30)]) });

  await user.click(screen.getByRole('button', { name: '现在做' }));

  expect(screen.queryByRole('button', { name: /开始.*计时/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '完成了' })).toBeVisible();
});
