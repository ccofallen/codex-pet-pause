import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AppProvider } from '../../../app/AppProvider';
import type { AppController } from '../../../app/appController';
import { createDefaultSettings } from '../../../app/defaults';
import type { AppSnapshot } from '../../../app/model';
import type { PresetReminderType } from '../../reminders/domain/types';
import { InteractiveCatStage, type CatStageRuntime } from './InteractiveCatStage';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Locale } from '../../../i18n/types';

const NOW = 1_800_000_000_000;
const GLOBAL_CSS = readFileSync('src/styles/global.css', 'utf8');

interface MutableController extends AppController {
  publishDue(type?: PresetReminderType): void;
  publishIntent(id: string): void;
  publishAnimationsEnabled(enabled: boolean): void;
  republish(): void;
}

interface RuntimeHarness {
  runtime: CatStageRuntime;
  flushFrame(): void;
  random: ReturnType<typeof vi.fn<() => number>>;
  cancelFrame: ReturnType<typeof vi.fn<(handle: number) => void>>;
  frameCount(): number;
}

function createController({ animationsEnabled = true } = {}): MutableController {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.animationsEnabled = animationsEnabled;
  let snapshot: AppSnapshot = {
    ready: true,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [] },
    storageMode: 'persistent',
    notificationStatus: 'granted',
    pets: [],
  };
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  let completionIndex = 0;
  const removeDue = (id: string, completed: boolean) => {
    snapshot = {
      ...snapshot,
      scheduler: {
        ...snapshot.scheduler,
        dueQueue: snapshot.scheduler.dueQueue.filter((item) => item.reminderId !== id),
      },
      ...(completed ? {
        catIntent: 'celebrate' as const,
        catIntentEventId: `stage-completion-${completionIndex += 1}`,
      } : {}),
    };
    publish();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: vi.fn(async () => undefined),
    reconcileNow: vi.fn(async () => undefined),
    complete: vi.fn(async (id: string) => removeDue(id, true)),
    snooze: vi.fn(async (id: string) => removeDue(id, false)),
    skip: vi.fn(async (id: string) => removeDue(id, false)),
    pause: vi.fn(async () => undefined),
    resumePause: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    saveSettings: vi.fn(async () => undefined),
    savePet: vi.fn(async () => undefined),
    deletePet: vi.fn(async () => undefined),
    selectPet: vi.fn(async () => undefined),
    savePetPosition: vi.fn(async () => undefined),
    requestNotifications: vi.fn(async (): Promise<AppSnapshot['notificationStatus']> => 'granted'),
    listHistorySince: vi.fn(async () => []),
    clearAll: vi.fn(async () => undefined),
    publishDue(type) {
      const due = type === undefined
        ? []
        : snapshot.scheduler.reminders
          .filter((item) => item.id === type)
          .map((item) => ({ reminderId: item.id, dueAt: NOW }));
      snapshot = { ...snapshot, scheduler: { ...snapshot.scheduler, dueQueue: due } };
      publish();
    },
    publishIntent(id) {
      snapshot = { ...snapshot, catIntent: 'celebrate', catIntentEventId: id };
      publish();
    },
    publishAnimationsEnabled(enabled) {
      snapshot = {
        ...snapshot,
        settings: { ...snapshot.settings, animationsEnabled: enabled },
      };
      publish();
    },
    republish() {
      snapshot = { ...snapshot, scheduler: { ...snapshot.scheduler } };
      publish();
    },
  };
}

function createRuntime(randomValue = 0): RuntimeHarness {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const random = vi.fn(() => randomValue);
  const cancelFrame = vi.fn((handle: number) => { frames.delete(handle); });
  const runtime: CatStageRuntime = {
    now: () => Date.now(),
    random,
    requestFrame: vi.fn((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    }),
    cancelFrame,
  };
  return {
    runtime,
    random,
    cancelFrame,
    frameCount: () => frames.size,
    flushFrame() {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(Date.now());
    },
  };
}

function installMedia({ reduced = false, fine = true } = {}) {
  let reducedMatches = reduced;
  const reducedListeners = new Set<(event: MediaQueryListEvent) => void>();
  const reducedMedia = {
    get matches() { return reducedMatches; },
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      reducedListeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      reducedListeners.delete(listener);
    }),
  };
  const fineMedia = {
    matches: fine,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => (
    query === '(prefers-reduced-motion: reduce)' ? reducedMedia : fineMedia
  )));
  return {
    reducedMedia,
    fineMedia,
    publishReduced(next: boolean) {
      reducedMatches = next;
      reducedListeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}

function renderInteractiveStage({
  controller = createController(),
  runtimeHarness = createRuntime(),
  control,
  locale = 'zh-CN',
}: {
  controller?: MutableController;
  runtimeHarness?: RuntimeHarness;
  control?: ReactNode;
  locale?: Locale;
} = {}) {
  const ui = (currentLocale: Locale) => (
    <AppProvider controller={controller}>
      <I18nProvider locale={currentLocale}>
        {control}
        <InteractiveCatStage runtime={runtimeHarness.runtime} />
      </I18nProvider>
    </AppProvider>
  );
  const result = render(ui(locale));
  return {
    ...result,
    controller,
    runtimeHarness,
    publishDue: controller.publishDue,
    publishIntent: controller.publishIntent,
    user: userEvent.setup({ advanceTimers: (delay) => vi.advanceTimersByTimeAsync(delay) }),
    rerenderLocale: (nextLocale: Locale) => result.rerender(ui(nextLocale)),
  };
}

function installPointerCapture(cat: HTMLElement) {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(cat, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

function beginDrag(cat: HTMLElement, dx = 6, dy = 0) {
  fireEvent.pointerDown(cat, { pointerId: 7, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(cat, { pointerId: 7, clientX: 100 + dx, clientY: 100 + dy });
}

function advanceCompletedWanders(delay: number, count: number) {
  for (let index = 0; index < count; index += 1) {
    act(() => vi.advanceTimersByTime(delay));
    act(() => vi.advanceTimersByTime(2_400));
  }
}

test('keeps the built-in atlas and picked-up drag pose alongside its autonomous repertoire', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  expect(screen.getByTestId('cat-atlas-loader'))
    .toHaveAttribute('src', '/assets/cat/neko-pause-cat.webp');
  installPointerCapture(cat);

  beginDrag(cat);

  expect(cat).toHaveAttribute('data-mode', 'dragging');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '5');
  // Dedicated tests below continue to cover wandering, chasing, and eating timers.
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('jest', { advanceTimersByTime: (delay: number) => vi.advanceTimersByTime(delay) });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_000, writable: true });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700, writable: true });
  installMedia();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('pets on click but opens the bubble when due', async () => {
  const { user, publishDue } = renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  await user.click(cat);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'reacting');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '8');

  act(() => publishDue('lookAway'));
  expect(cat).toHaveAccessibleName('Momo 有一项提醒，打开');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(cat);
  expect(screen.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  expect(screen.getByTestId('cat-sprite')).not.toHaveAttribute('data-row', '3');
});

test('localizes the built-in cat without restarting its interaction state', () => {
  const { controller, rerenderLocale } = renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  fireEvent.click(cat);
  expect(cat).toHaveAttribute('data-mode', 'reacting');

  rerenderLocale('en');
  expect(screen.getByRole('button', { name: 'Pet Momo' })).toBe(cat);
  expect(cat).toHaveAttribute('data-mode', 'reacting');

  act(() => controller.publishDue('lookAway'));
  expect(cat).toHaveAccessibleName('Open reminder for Momo');
});

test('Escape returns an unprocessed due cat to waiting and allows the bubble to reopen', async () => {
  const { user, publishDue, controller } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  const cat = screen.getByRole('button', { name: 'Momo 有一项提醒，打开' });
  await user.click(cat);

  await user.keyboard('{Escape}');

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'waiting');
  expect(controller.getSnapshot().scheduler.dueQueue).toHaveLength(1);
  expect(controller.complete).not.toHaveBeenCalled();
  expect(controller.snooze).not.toHaveBeenCalled();
  expect(controller.skip).not.toHaveBeenCalled();

  await user.click(cat);
  expect(screen.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
});

test('treats exactly 5px of movement as a click without pointer capture', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);

  beginDrag(cat, 3, 4);
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 103, clientY: 104 });

  expect(capture.setPointerCapture).not.toHaveBeenCalled();
  expect(capture.releasePointerCapture).not.toHaveBeenCalled();
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'reacting');
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('starts dragging at exactly 6px, captures the pointer, moves, and releases on drop', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);

  beginDrag(cat);
  expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'dragging');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '5');
  expect(cat).toHaveStyle({ transform: 'translate3d(842px, 96px, 0)' });

  fireEvent.pointerMove(cat, { pointerId: 7, clientX: 116, clientY: 110 });
  expect(cat).toHaveStyle({ transform: 'translate3d(852px, 106px, 0)' });
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 116, clientY: 110 });
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');
});

test('ignores a second pointer while the owning pointer drag is active', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);
  beginDrag(cat);

  fireEvent.pointerDown(cat, { pointerId: 8, clientX: 400, clientY: 400 });
  fireEvent.pointerMove(cat, { pointerId: 8, clientX: 450, clientY: 450 });
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 106, clientY: 100 });

  expect(capture.setPointerCapture).toHaveBeenCalledTimes(1);
  expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');
});

test('keeps a normal drop resting for exactly twelve seconds', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  installPointerCapture(cat);
  beginDrag(cat);
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 106, clientY: 100 });

  act(() => vi.advanceTimersByTime(11_999));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'reacting');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('returns a due cat directly to waiting after a drop', () => {
  const { publishDue } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  const cat = screen.getByRole('button', { name: 'Momo 有一项提醒，打开' });
  installPointerCapture(cat);

  beginDrag(cat);
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 106, clientY: 100 });

  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'waiting');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('pointer cancellation never activates the cat and does not suppress the next click', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });

  fireEvent.pointerDown(cat, { pointerId: 7, clientX: 100, clientY: 100 });
  fireEvent.pointerCancel(cat, { pointerId: 7, clientX: 100, clientY: 100 });

  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
  fireEvent.click(cat);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('lost capture suppresses its pointer click but allows keyboard and a new pointer sequence', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);
  beginDrag(cat);

  fireEvent.lostPointerCapture(cat, { pointerId: 7 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');
  expect(capture.releasePointerCapture).not.toHaveBeenCalled();
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 106, clientY: 100 });
  fireEvent.click(cat, { detail: 1 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');

  fireEvent.click(cat, { detail: 0 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
  act(() => vi.advanceTimersByTime(1_500));
  fireEvent.pointerDown(cat, { pointerId: 8, clientX: 200, clientY: 200 });
  fireEvent.pointerUp(cat, { pointerId: 8, clientX: 200, clientY: 200 });
  fireEvent.click(cat, { detail: 1 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('keyboard activation does not consume suppression for the stale lost-capture pointer click', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  installPointerCapture(cat);
  beginDrag(cat);

  fireEvent.lostPointerCapture(cat, { pointerId: 7 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');

  fireEvent.click(cat, { detail: 0 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
  act(() => vi.advanceTimersByTime(500));
  fireEvent.click(cat, { detail: 1 });
  act(() => vi.advanceTimersByTime(1_001));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');

  fireEvent.pointerDown(cat, { pointerId: 8, clientX: 200, clientY: 200 });
  fireEvent.pointerUp(cat, { pointerId: 8, clientX: 200, clientY: 200 });
  fireEvent.click(cat, { detail: 1 });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('intentional pointer release ignores its lost-capture event and finishes once', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);
  capture.releasePointerCapture.mockImplementation((pointerId: number) => {
    fireEvent.lostPointerCapture(cat, { pointerId });
  });
  beginDrag(cat);

  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 106, clientY: 100 });

  expect(capture.releasePointerCapture).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');
  act(() => vi.advanceTimersByTime(12_000));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('clamps the existing position on resize without choosing a random replacement', () => {
  const runtimeHarness = createRuntime();
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  expect(cat).toHaveStyle({ transform: 'translate3d(836px, 96px, 0)' });
  runtimeHarness.random.mockClear();

  window.innerWidth = 500;
  window.innerHeight = 180;
  fireEvent(window, new Event('resize'));

  expect(cat).toHaveStyle({ transform: 'translate3d(360px, 28px, 0)' });
  expect(runtimeHarness.random).not.toHaveBeenCalled();
});

test('moves 20px with arrows and 80px with Shift+arrow using drop rest semantics', () => {
  renderInteractiveStage();
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });

  expect(fireEvent.keyDown(cat, { key: 'ArrowLeft' })).toBe(false);
  expect(cat).toHaveStyle({ transform: 'translate3d(816px, 96px, 0)' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'dropped');
  expect(fireEvent.keyDown(cat, { key: 'ArrowLeft', shiftKey: true })).toBe(false);
  expect(cat).toHaveStyle({ transform: 'translate3d(736px, 96px, 0)' });
  expect(fireEvent.keyDown(cat, { key: 'Home' })).toBe(true);
});

test('keeps an open bubble anchored to a dragged cat', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 320, height: 240, top: 0, right: 320, bottom: 240, left: 0,
    toJSON: () => undefined,
  });
  const { user, publishDue } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  const cat = screen.getByRole('button', { name: 'Momo 有一项提醒，打开' });
  await user.click(cat);
  expect(screen.getByRole('dialog')).toHaveStyle({ left: '504px', top: '52px' });
  installPointerCapture(cat);

  beginDrag(cat, -100, 0);

  expect(cat).toHaveStyle({ transform: 'translate3d(736px, 96px, 0)' });
  expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'bottom');
  expect(screen.getByRole('dialog')).toHaveStyle({ left: '646px', top: '260px' });
});

test('drags an open-bubble cat without moving aria-modal focus out of the dialog', async () => {
  const { user, publishDue } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  const cat = screen.getByRole('button', { name: 'Momo 有一项提醒，打开' });
  await user.click(cat);
  const focusedAction = screen.getByRole('button', { name: '现在做' });
  expect(focusedAction).toHaveFocus();
  installPointerCapture(cat);

  expect(fireEvent.pointerDown(cat, { pointerId: 7, clientX: 100, clientY: 100 })).toBe(false);
  fireEvent.pointerMove(cat, { pointerId: 7, clientX: 106, clientY: 100 });

  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'dragging');
  expect(focusedAction).toHaveFocus();
});

test('retains the final completion confirmation until its explicit close control is used', async () => {
  const { user, publishDue } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  await user.click(screen.getByRole('button', { name: 'Momo 有一项提醒，打开' }));
  await user.click(screen.getByRole('button', { name: '现在做' }));

  await user.click(screen.getByRole('button', { name: '完成了' }));

  expect(screen.getByRole('status')).toHaveTextContent('目视远方已完成');
  expect(screen.getByRole('button', { name: '关闭' })).toBeVisible();
  expect(screen.getByRole('dialog', { name: '目视远方提醒' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each([
  ['Skip', '跳过'],
  ['Snooze', '10 分钟'],
] as const)('closes the final reminder immediately after %s empties the queue', async (command, buttonName) => {
  const { user, publishDue } = renderInteractiveStage();
  act(() => publishDue('lookAway'));
  await user.click(screen.getByRole('button', { name: 'Momo 有一项提醒，打开' }));
  if (command === 'Snooze') await user.click(screen.getByRole('button', { name: '稍后提醒' }));

  await user.click(screen.getByRole('button', { name: buttonName }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.each([
  ['reduced motion', { reduced: true, animationsEnabled: true }],
  ['animation setting off', { reduced: false, animationsEnabled: false }],
] as const)('disables autonomous timers and pointer chasing when %s', (_label, options) => {
  installMedia({ reduced: options.reduced });
  const runtimeHarness = createRuntime();
  renderInteractiveStage({
    controller: createController({ animationsEnabled: options.animationsEnabled }),
    runtimeHarness,
  });

  fireEvent.pointerMove(window, { clientX: 500, clientY: 200, pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(60_000));

  expect(runtimeHarness.runtime.requestFrame).not.toHaveBeenCalled();
  expect(runtimeHarness.random).not.toHaveBeenCalled();
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
  expect(vi.getTimerCount()).toBe(0);
});

test('coalesces pointer samples into one frame and uses the idle gaze atlas', () => {
  const runtimeHarness = createRuntime();
  renderInteractiveStage({ runtimeHarness });

  fireEvent.pointerMove(window, { clientX: 906, clientY: 70, pointerType: 'mouse' });
  fireEvent.pointerMove(window, { clientX: 1_000, clientY: 172, pointerType: 'mouse' });
  expect(runtimeHarness.runtime.requestFrame).toHaveBeenCalledTimes(1);
  act(() => runtimeHarness.flushFrame());

  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '9');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-column', '4');
});

test('chases a fast pointer for at most three seconds with a bounded cooldown', () => {
  const runtimeHarness = createRuntime();
  renderInteractiveStage({ runtimeHarness });

  fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  vi.setSystemTime(NOW + 100);
  fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());

  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'chasing');
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-cooldown-until', String(NOW + 20_100));
  act(() => vi.advanceTimersByTime(2_999));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'chasing');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('chases progressively toward the latest pointer sample when the pointer stops', () => {
  const runtimeHarness = createRuntime();
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });

  fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  vi.setSystemTime(NOW + 100);
  fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());

  expect(cat).toHaveStyle({ transform: 'translate3d(836px, 96px, 0)' });
  expect(runtimeHarness.frameCount()).toBe(1);

  vi.setSystemTime(NOW + 200);
  act(() => runtimeHarness.flushFrame());
  expect(cat).toHaveStyle({ transform: 'translate3d(788px, 96px, 0)' });
  expect(cat).toHaveAttribute('data-mode', 'chasing');

  vi.setSystemTime(NOW + 300);
  act(() => runtimeHarness.flushFrame());
  expect(cat).toHaveStyle({ transform: 'translate3d(740px, 96px, 0)' });
  expect(cat).toHaveAttribute('data-mode', 'chasing');
  expect(runtimeHarness.frameCount()).toBe(1);

  vi.setSystemTime(NOW + 400);
  act(() => runtimeHarness.flushFrame());
  expect(cat).toHaveStyle({ transform: 'translate3d(720px, 96px, 0)' });
  vi.setSystemTime(NOW + 500);
  act(() => runtimeHarness.flushFrame());
  expect(cat).toHaveAttribute('data-mode', 'pouncing');
  expect(runtimeHarness.frameCount()).toBe(0);
});

test('pounces only once per chase and keeps the first 900ms deadline', () => {
  const runtimeHarness = createRuntime();
  renderInteractiveStage({ runtimeHarness });
  fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  vi.setSystemTime(NOW + 100);
  fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'chasing');

  fireEvent.pointerMove(window, { clientX: 850, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'pouncing');
  act(() => vi.advanceTimersByTime(100));
  fireEvent.pointerMove(window, { clientX: 860, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());

  act(() => vi.advanceTimersByTime(800));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('wanders after 8 seconds and finishes its 2.4 second movement', () => {
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });

  act(() => vi.advanceTimersByTime(7_999));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'moving');
  expect(cat).toHaveStyle({ transform: 'translate3d(0px, 0px, 0)' });
  expect(cat.style.transition).toContain('2400ms');
  act(() => vi.advanceTimersByTime(2_399));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'moving');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('eats at the two-minute boundary and finishes after 2.4 seconds', () => {
  renderInteractiveStage({ runtimeHarness: createRuntime(0) });
  advanceCompletedWanders(8_000, 11);
  act(() => vi.advanceTimersByTime(5_599));
  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'eating');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'eating');
  expect(screen.getByTestId('cat-sprite')).toHaveAttribute('data-row', '3');
  act(() => vi.advanceTimersByTime(2_399));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'eating');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('keeps one eating deadline across autonomous walking and eats after an overlapping walk', () => {
  const runtimeHarness = createRuntime();
  runtimeHarness.random.mockImplementationOnce(() => 0).mockImplementation(() => 0.975);
  renderInteractiveStage({ runtimeHarness });
  advanceCompletedWanders(17_750, 5);
  act(() => vi.advanceTimersByTime(17_750));
  act(() => vi.advanceTimersByTime(1_499));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'moving');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'moving');
  act(() => vi.advanceTimersByTime(899));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'moving');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'eating');
});

test('cancels eating for a due reminder and disables all eating timers with reduced motion', () => {
  const media = installMedia();
  const { publishDue } = renderInteractiveStage({ runtimeHarness: createRuntime(0) });
  act(() => vi.advanceTimersByTime(120_000));
  act(() => publishDue('lookAway'));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'waiting');
  act(() => media.publishReduced(true));
  expect(vi.getTimerCount()).toBe(0);
});

test('uses the four-minute upper bound without restarting on snapshot publication', () => {
  const runtimeHarness = createRuntime(1);
  const { controller } = renderInteractiveStage({ runtimeHarness });
  act(() => vi.advanceTimersByTime(120_000));
  act(() => controller.republish());
  act(() => vi.advanceTimersByTime(119_999));
  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'eating');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'eating');
});

test('reschedules after text focus and clears component timers on unmount', () => {
  const runtimeHarness = createRuntime(0);
  const view = renderInteractiveStage({
    runtimeHarness,
    control: <input aria-label="测试输入" />,
  });
  fireEvent.focusIn(screen.getByLabelText('测试输入'));
  act(() => vi.advanceTimersByTime(240_000));
  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'eating');
  fireEvent.focusOut(screen.getByLabelText('测试输入'), { relatedTarget: null });
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('freezes an in-flight wander at its rendered location when a reminder becomes due', () => {
  const runtimeHarness = createRuntime(0);
  const { publishDue } = renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 400, top: 150, width: 140, height: 152 }),
  });

  act(() => publishDue('lookAway'));

  expect(cat).toHaveStyle({ transform: 'translate3d(400px, 150px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'waiting');
});

test('freezes an in-flight wander at its rendered location for a completion reaction', () => {
  const runtimeHarness = createRuntime(0);
  const { publishIntent } = renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 410, top: 160, width: 140, height: 152 }),
  });

  act(() => publishIntent('wander-completion'));

  expect(cat).toHaveStyle({ transform: 'translate3d(410px, 160px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'completed');
});

test('starts a drag from the rendered location of an interrupted wander', () => {
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  installPointerCapture(cat);
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 420, top: 170, width: 140, height: 152 }),
  });

  beginDrag(cat);

  expect(cat).toHaveStyle({ transform: 'translate3d(426px, 170px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'dragging');
});

test('freezes an in-flight wander before the animation setting disables motion', () => {
  const runtimeHarness = createRuntime(0);
  const controller = createController();
  renderInteractiveStage({ controller, runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 430, top: 180, width: 140, height: 152 }),
  });

  act(() => controller.publishAnimationsEnabled(false));

  expect(cat).toHaveStyle({ transform: 'translate3d(430px, 180px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('freezes an in-flight wander before reduced motion disables motion', () => {
  const media = installMedia();
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 440, top: 190, width: 140, height: 152 }),
  });

  act(() => media.publishReduced(true));

  expect(cat).toHaveStyle({ transform: 'translate3d(440px, 190px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('reduced-motion CSS leaves the cat button transition intact until React freezes it', () => {
  const mediaStart = GLOBAL_CSS.indexOf('@media (prefers-reduced-motion: reduce)');
  const mediaEnd = GLOBAL_CSS.indexOf('/* Release visual system', mediaStart);
  const reducedMotionCss = GLOBAL_CSS.slice(mediaStart, mediaEnd);

  expect(mediaStart).toBeGreaterThanOrEqual(0);
  expect(reducedMotionCss).toContain('*:not(.interactive-cat-button)');
  expect(reducedMotionCss).not.toMatch(/(?:^|,)\s*\.interactive-cat-button\s*(?:,|\{)/m);
  expect(reducedMotionCss).toMatch(/\.cat-sprite\s*\{[^}]*transition:\s*none\s*!important/s);
});

test('pets from the rendered position after sub-threshold movement interrupts a wander', () => {
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 450, top: 200, width: 140, height: 152 }),
  });

  fireEvent.pointerDown(cat, { pointerId: 7, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(cat, { pointerId: 7, clientX: 103, clientY: 104 });
  fireEvent.pointerUp(cat, { pointerId: 7, clientX: 103, clientY: 104 });

  expect(cat).toHaveStyle({ transform: 'translate3d(450px, 200px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('keyboard activation pets from the rendered position of an interrupted wander', async () => {
  const runtimeHarness = createRuntime(0);
  const { user } = renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  act(() => vi.advanceTimersByTime(8_000));
  Object.defineProperty(cat, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 460, top: 210, width: 140, height: 152 }),
  });
  cat.focus();

  await user.keyboard('{Enter}');

  expect(cat).toHaveStyle({ transform: 'translate3d(460px, 210px, 0)', transition: 'none' });
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'petted');
});

test('focused text entry suppresses chase and wandering until focus leaves', () => {
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness, control: <input aria-label="猫名" /> });
  fireEvent.focus(screen.getByRole('textbox', { name: '猫名' }));
  runtimeHarness.random.mockClear();

  fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  vi.setSystemTime(NOW + 100);
  fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  act(() => vi.advanceTimersByTime(18_000));

  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'chasing');
  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'moving');
  expect(runtimeHarness.random).not.toHaveBeenCalled();
});

test.each([
  ['textarea', <textarea key="textarea" aria-label="文字控件" />],
  ['contenteditable', <div key="editable" role="textbox" aria-label="文字控件" contentEditable />],
] as const)('focused %s remains a text-entry chase gate', (_label, control) => {
  const runtimeHarness = createRuntime(0);
  renderInteractiveStage({ runtimeHarness, control });
  fireEvent.focus(screen.getByRole('textbox', { name: '文字控件' }));

  fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());
  vi.setSystemTime(NOW + 100);
  fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
  act(() => runtimeHarness.flushFrame());

  expect(screen.getByTestId('cat-stage')).not.toHaveAttribute('data-mode', 'chasing');
});

test.each(['checkbox', 'radio', 'range', 'button'] as const)(
  'focused %s input does not suppress chase',
  (type) => {
    const runtimeHarness = createRuntime(0);
    renderInteractiveStage({
      runtimeHarness,
      control: <input type={type} aria-label="非文字控件" value={type === 'button' ? '按钮' : undefined} />,
    });
    fireEvent.focus(screen.getByLabelText('非文字控件'));

    fireEvent.pointerMove(window, { clientX: 600, clientY: 172, pointerType: 'mouse' });
    act(() => runtimeHarness.flushFrame());
    vi.setSystemTime(NOW + 100);
    fireEvent.pointerMove(window, { clientX: 700, clientY: 172, pointerType: 'mouse' });
    act(() => runtimeHarness.flushFrame());

    expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'chasing');
  },
);

test('handles each completion event id once without replay after snapshot publication', () => {
  const { controller, publishIntent } = renderInteractiveStage();

  act(() => publishIntent('completion-1'));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'completed');
  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');

  act(() => controller.republish());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
  act(() => controller.publishDue('lookAway'));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'waiting');
  act(() => controller.publishDue());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');

  act(() => controller.republish());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');

  act(() => publishIntent('completion-2'));
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-reaction', 'completed');
  act(() => vi.advanceTimersByTime(1_500));
  act(() => controller.republish());
  expect(screen.getByTestId('cat-stage')).toHaveAttribute('data-mode', 'idle');
});

test('cleans up global listeners, media listeners, pending RAF, capture, and timeouts', () => {
  const media = installMedia();
  const removeWindowListener = vi.spyOn(window, 'removeEventListener');
  const runtimeHarness = createRuntime();
  const { unmount } = renderInteractiveStage({ runtimeHarness });
  const cat = screen.getByRole('button', { name: '摸摸 Momo' });
  const capture = installPointerCapture(cat);
  capture.releasePointerCapture.mockImplementation((pointerId: number) => {
    fireEvent.lostPointerCapture(cat, { pointerId });
  });
  beginDrag(cat);
  fireEvent.pointerMove(window, { clientX: 500, clientY: 200, pointerType: 'mouse' });

  expect(() => unmount()).not.toThrow();

  expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(removeWindowListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
  expect(removeWindowListener).toHaveBeenCalledWith('focusin', expect.any(Function));
  expect(removeWindowListener).toHaveBeenCalledWith('focusout', expect.any(Function));
  expect(media.reducedMedia.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(runtimeHarness.cancelFrame).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
