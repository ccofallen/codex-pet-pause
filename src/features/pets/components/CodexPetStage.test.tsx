import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AppController } from '../../../app/appController';
import { createDefaultSettings } from '../../../app/defaults';
import type { AppSnapshot } from '../../../app/model';
import { AppProvider } from '../../../app/AppProvider';
import type { PresetReminderType } from '../../reminders/domain/types';
import type { StoredCodexPet } from '../domain/types';
import { CodexPetStage } from './CodexPetStage';
import { I18nProvider } from '../../../i18n/I18nProvider';
import type { Locale } from '../../../i18n/types';

const NOW = 1_800_000_000_000;
const PET: StoredCodexPet = {
  id: 'murk',
  displayName: 'Murk',
  spriteVersion: 2,
  spritesheetFilename: 'murk.png',
  spritesheet: new Blob(['atlas'], { type: 'image/png' }),
  importedAt: NOW,
  updatedAt: NOW,
};

interface MutableController extends AppController {
  publishDue(type?: PresetReminderType): void;
  publishError(error?: AppSnapshot['petLibraryError']): void;
}

function createController({
  animationsEnabled = true,
  position = { xRatio: 0.5, yRatio: 0.25 },
} = {}): MutableController {
  const settings = createDefaultSettings(NOW);
  settings.onboardingComplete = true;
  settings.animationsEnabled = animationsEnabled;
  settings.activePetId = PET.id;
  settings.petPosition = position;
  let snapshot: AppSnapshot = {
    ready: true,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [] },
    storageMode: 'persistent',
    notificationStatus: 'granted',
    pets: [PET],
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
        catIntentEventId: `codex-completion-${completionIndex += 1}`,
      } : {}),
    };
    publish();
  };
  const controller: MutableController = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: vi.fn(async () => undefined),
    reconcileNow: vi.fn(async () => undefined),
    applyCommittedRuntimeState: vi.fn(),
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
    savePetPosition: vi.fn(async (next) => {
      snapshot = { ...snapshot, settings: { ...snapshot.settings, petPosition: next } };
      publish();
    }),
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
    publishError(error) {
      const { petLibraryError: _previous, ...rest } = snapshot;
      snapshot = error === undefined ? rest : { ...rest, petLibraryError: error };
      publish();
    },
  };
  return controller;
}

function installMedia({ reduced = false, fine = true } = {}) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduced : fine,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function renderStage(
  controller = createController(),
  pet = PET,
  random: () => number = () => 0.5,
  locale: Locale = 'zh-CN',
) {
  const ui = (currentPet: StoredCodexPet, currentLocale: Locale) => (
    <AppProvider controller={controller}>
      <I18nProvider locale={currentLocale}>
        <div className="app-shell">
          <CodexPetStage pet={currentPet} random={random} />
        </div>
      </I18nProvider>
    </AppProvider>
  );
  const result = render(ui(pet, locale));
  return {
    ...result,
    controller,
    rerenderStage: (nextPet = pet, nextLocale = locale) => result.rerender(ui(nextPet, nextLocale)),
  };
}

function installPointerCapture(pet: HTMLElement) {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(pet, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.innerWidth = 1_000;
  window.innerHeight = 800;
  installMedia();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:active-pet'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('stays fixed for five minutes while autonomous behavior runs', () => {
  renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  expect(stage).toHaveStyle({ transform: 'translate3d(430px, 162px, 0)' });

  act(() => vi.advanceTimersByTime(300_000));

  expect(stage).toHaveStyle({ transform: 'translate3d(430px, 162px, 0)' });
});

test('localizes an imported pet name without restarting its behavior', () => {
  const imported = { ...PET, displayName: '月影' };
  const { controller, rerenderStage } = renderStage(createController(), imported);
  const stage = screen.getByRole('button', { name: '摸摸 月影' });
  fireEvent.click(stage);
  expect(stage).toHaveAttribute('data-mode', 'reacting');

  rerenderStage(imported, 'en');
  expect(screen.getByRole('button', { name: 'Pet 月影' })).toBe(stage);
  expect(stage).toHaveAttribute('data-mode', 'reacting');
  act(() => controller.publishDue('lookAway'));
  expect(stage).toHaveAccessibleName('Open reminder for 月影');
});

test('tracks the pointer for six seconds only after click and departure beyond 48px', () => {
  renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  const sprite = screen.getByTestId('pet-sprite');

  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(sprite).toHaveAttribute('data-row', '0');

  fireEvent.click(stage);
  fireEvent.pointerMove(window, { clientX: 618, clientY: 238, pointerType: 'mouse' });
  expect(sprite).not.toHaveAttribute('data-row', '9');

  fireEvent.pointerMove(window, { clientX: 619, clientY: 238, pointerType: 'mouse' });
  expect(sprite).toHaveAttribute('data-row', '9');
  act(() => vi.advanceTimersByTime(5_999));
  expect(sprite).toHaveAttribute('data-row', '9');
  act(() => vi.advanceTimersByTime(1));
  expect(sprite).toHaveAttribute('data-row', '0');
});

test('expires an armed attention session after six seconds without departure', () => {
  renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  const sprite = screen.getByTestId('pet-sprite');
  fireEvent.click(stage);
  act(() => vi.advanceTimersByTime(6_000));
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(sprite).toHaveAttribute('data-row', '0');
});

test('never tracks for v1 pets, reduced motion, or disabled animations', () => {
  const v1 = { ...PET, id: 'v1', spriteVersion: 1 as const };
  const first = renderStage(createController(), v1);
  fireEvent.click(screen.getByRole('button', { name: '摸摸 Murk' }));
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).not.toHaveAttribute('data-row', '9');
  first.unmount();

  installMedia({ reduced: true });
  const second = renderStage();
  fireEvent.click(screen.getByRole('button', { name: '摸摸 Murk' }));
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).not.toHaveAttribute('data-row', '9');
  second.unmount();

  installMedia();
  renderStage(createController({ animationsEnabled: false }));
  fireEvent.click(screen.getByRole('button', { name: '摸摸 Murk' }));
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).not.toHaveAttribute('data-row', '9');
});

test('a due reminder interrupts tracking and removes its pointer listener behavior', () => {
  const { controller } = renderStage();
  fireEvent.click(screen.getByRole('button', { name: '摸摸 Murk' }));
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '9');

  act(() => controller.publishDue('lookAway'));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '6');

  act(() => controller.publishDue());
  fireEvent.pointerMove(window, { clientX: 400, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
});

test('switching pets clears an armed attention session', () => {
  const { rerenderStage } = renderStage();
  fireEvent.click(screen.getByRole('button', { name: '摸摸 Murk' }));

  const next = {
    ...PET, id: 'luna', displayName: 'Luna', spritesheet: new Blob(['next']),
  };
  rerenderStage(next);
  fireEvent.pointerMove(window, { clientX: 930, clientY: 238, pointerType: 'mouse' });
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
});

test('switching pets preserves a reminder that remains due', () => {
  const { controller, rerenderStage } = renderStage();
  act(() => controller.publishDue('lookAway'));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '6');

  const next = {
    ...PET, id: 'luna', displayName: 'Luna', spritesheet: new Blob(['next']),
  };
  rerenderStage(next);

  expect(screen.getByTestId('pet-stage')).toHaveAttribute('data-mode', 'waiting');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '6');
  fireEvent.click(screen.getByRole('button', { name: 'Luna 有一项提醒，打开' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByTestId('pet-stage')).toHaveAttribute('data-mode', 'waiting');
});

test('starts a selected ambient animation after 12–25 seconds for one visible loop', () => {
  const random = vi.fn()
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0.5)
    .mockReturnValue(1);
  renderStage(createController(), PET, random);
  const sprite = screen.getByTestId('pet-sprite');

  act(() => vi.advanceTimersByTime(11_999));
  expect(sprite).toHaveAttribute('data-row', '0');
  act(() => vi.advanceTimersByTime(1));
  expect(sprite).toHaveAttribute('data-row', '8');
  act(() => vi.advanceTimersByTime(1_029));
  expect(sprite).toHaveAttribute('data-row', '8');
  act(() => vi.advanceTimersByTime(1));
  expect(sprite).toHaveAttribute('data-row', '0');
});

test('opens a due bubble only on activation and closes after work, snooze, and skip', async () => {
  const { controller } = renderStage();
  act(() => controller.publishDue('lookAway'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Murk 有一项提醒，打开' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '现在做' }));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '7');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '完成了' })));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  act(() => controller.publishDue('lookAway'));
  fireEvent.click(screen.getByRole('button', { name: 'Murk 有一项提醒，打开' }));
  fireEvent.click(screen.getByRole('button', { name: '稍后提醒' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '5 分钟' })));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');

  act(() => controller.publishDue('lookAway'));
  fireEvent.click(screen.getByRole('button', { name: 'Murk 有一项提醒，打开' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '跳过' })));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '0');
});

test('returns from an escaped active action to waiting while its reminder remains due', () => {
  const { controller } = renderStage();
  act(() => controller.publishDue('lookAway'));
  fireEvent.click(screen.getByRole('button', { name: 'Murk 有一项提醒，打开' }));
  fireEvent.click(screen.getByRole('button', { name: '现在做' }));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '7');

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '6');
});

test('drags with directional rows and persists the normalized clamped release position', async () => {
  const { controller } = renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  installPointerCapture(stage);

  fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 400, clientY: 350 });
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '2');
  expect(stage).toHaveStyle({ transform: 'translate3d(330px, 212px, 0)' });
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 600, clientY: 350 });
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '1');
  fireEvent.pointerUp(stage, { pointerId: 7, clientX: 600, clientY: 350 });

  expect(controller.savePetPosition).toHaveBeenCalledWith({
    xRatio: 530 / 860,
    yRatio: 212 / 648,
  });
});

test('restores the saved position after remount and clamps it after viewport resize', () => {
  const controller = createController({ position: { xRatio: 0.9, yRatio: 0.8 } });
  const first = renderStage(controller);
  expect(screen.getByRole('button', { name: '摸摸 Murk' }))
    .toHaveStyle({ transform: 'translate3d(774px, 518.4px, 0)' });
  first.unmount();
  renderStage(controller);

  window.innerWidth = 500;
  window.innerHeight = 180;
  fireEvent(window, new Event('resize'));

  expect(screen.getByRole('button', { name: '摸摸 Murk' }))
    .toHaveStyle({ transform: 'translate3d(360px, 28px, 0)' });
});

test('is keyboard activatable and shows representative static reaction frames with reduced motion', () => {
  installMedia({ reduced: true });
  renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  stage.focus();

  fireEvent.click(stage, { detail: 0 });

  expect(stage).toHaveAttribute('data-mode', 'reacting');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '3');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
  act(() => vi.advanceTimersByTime(899));
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-column', '0');
  act(() => vi.advanceTimersByTime(1));
  expect(stage).toHaveAttribute('data-mode', 'idle');
});

test('reacts once to each new active write failure without changing due state', () => {
  const { controller } = renderStage();
  act(() => controller.publishDue('lookAway'));
  act(() => controller.publishError('write-failed'));
  expect(screen.getByTestId('pet-stage')).toHaveAttribute('data-mode', 'failed');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '5');

  act(() => vi.advanceTimersByTime(1_200));
  expect(screen.getByTestId('pet-stage')).toHaveAttribute('data-mode', 'waiting');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '6');
  act(() => controller.publishDue('lookAway'));
  expect(screen.getByTestId('pet-stage')).toHaveAttribute('data-mode', 'waiting');
});

test('keeps an error during drag failed through pointerup and ignores movement until timeout', () => {
  const { controller } = renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  installPointerCapture(stage);
  fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 400, clientY: 350 });
  expect(stage).toHaveStyle({ transform: 'translate3d(330px, 212px, 0)' });

  act(() => controller.publishError('write-failed'));
  expect(stage).toHaveAttribute('data-mode', 'failed');
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 300, clientY: 400 });
  expect(stage).toHaveStyle({ transform: 'translate3d(330px, 212px, 0)' });
  fireEvent.pointerUp(stage, { pointerId: 7, clientX: 300, clientY: 400 });

  expect(controller.savePetPosition).toHaveBeenCalledTimes(1);
  expect(stage).toHaveAttribute('data-mode', 'failed');
  expect(screen.getByTestId('pet-sprite')).toHaveAttribute('data-row', '5');
  act(() => vi.advanceTimersByTime(1_199));
  expect(stage).toHaveAttribute('data-mode', 'failed');
  act(() => vi.advanceTimersByTime(1));
  expect(stage).toHaveAttribute('data-mode', 'idle');
});

test('ignores a new drag session while failed', () => {
  const { controller } = renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  installPointerCapture(stage);
  act(() => controller.publishError('write-failed'));

  fireEvent.pointerDown(stage, { pointerId: 8, button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(stage, { pointerId: 8, clientX: 300, clientY: 400 });
  fireEvent.pointerUp(stage, { pointerId: 8, clientX: 300, clientY: 400 });

  expect(stage).toHaveStyle({ transform: 'translate3d(430px, 162px, 0)' });
  expect(stage).toHaveAttribute('data-mode', 'failed');
  expect(controller.savePetPosition).not.toHaveBeenCalled();
});

test('settles and persists once on lost capture, ignores trailing pointerup, and permits a new drag', () => {
  const { controller } = renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  installPointerCapture(stage);
  fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 400, clientY: 350 });

  fireEvent.lostPointerCapture(stage, { pointerId: 7 });
  expect(controller.savePetPosition).toHaveBeenCalledTimes(1);
  expect(stage).toHaveAttribute('data-mode', 'idle');
  fireEvent.pointerUp(stage, { pointerId: 7, clientX: 400, clientY: 350 });
  expect(controller.savePetPosition).toHaveBeenCalledTimes(1);
  fireEvent.click(stage, { detail: 1 });
  expect(stage).toHaveAttribute('data-mode', 'idle');

  fireEvent.pointerDown(stage, { pointerId: 8, button: 0, clientX: 400, clientY: 350 });
  fireEvent.pointerMove(stage, { pointerId: 8, clientX: 500, clientY: 350 });
  expect(stage).toHaveAttribute('data-mode', 'dragging');
  fireEvent.pointerUp(stage, { pointerId: 8, clientX: 500, clientY: 350 });
  expect(controller.savePetPosition).toHaveBeenCalledTimes(2);
});

test('settles and persists once on pointer cancel without duplicating on trailing pointerup', () => {
  const { controller } = renderStage();
  const stage = screen.getByRole('button', { name: '摸摸 Murk' });
  const capture = installPointerCapture(stage);
  fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(stage, { pointerId: 7, clientX: 400, clientY: 350 });

  fireEvent.pointerCancel(stage, { pointerId: 7 });
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(controller.savePetPosition).toHaveBeenCalledTimes(1);
  expect(stage).toHaveAttribute('data-mode', 'idle');
  fireEvent.pointerUp(stage, { pointerId: 7, clientX: 400, clientY: 350 });
  expect(controller.savePetPosition).toHaveBeenCalledTimes(1);

  fireEvent.pointerDown(stage, { pointerId: 8, button: 0, clientX: 400, clientY: 350 });
  fireEvent.pointerMove(stage, { pointerId: 8, clientX: 500, clientY: 350 });
  expect(stage).toHaveAttribute('data-mode', 'dragging');
  fireEvent.pointerCancel(stage, { pointerId: 8 });
  expect(controller.savePetPosition).toHaveBeenCalledTimes(2);
});

test('revokes active atlas object URLs on pet switch and unmount', () => {
  vi.mocked(URL.createObjectURL)
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:second');
  const { rerenderStage, unmount } = renderStage();
  const next = { ...PET, id: 'luna', displayName: 'Luna', spritesheet: new Blob(['next']) };

  rerenderStage(next);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
});
