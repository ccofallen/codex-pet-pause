import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import { isAndroidDetachedSurfaceRoute } from './AndroidDetachedSurfaceApp';
import { AndroidOverlayApp } from './AndroidOverlayApp';
import * as androidOverlayModule from './AndroidOverlayApp';

const REVISION = '0123456789abcdef0123456789abcdef';

function snapshotFor({
  size = 'medium',
  reminderDue = false,
  importedPet = false,
}: {
  size?: 'small' | 'medium' | 'large';
  reminderDue?: boolean;
  importedPet?: boolean;
} = {}): AndroidHostSnapshot {
  const settings = createDefaultSettings(1, 'en');
  settings.petSize = size;
  if (reminderDue) {
    settings.reminders[0] = {
      ...settings.reminders[0]!,
      enabled: true,
      status: 'due',
    };
  }
  const pet = {
    id: 'momo',
    metadataJson: JSON.stringify({
      id: 'momo',
      displayName: 'Momo',
      spriteVersion: 2,
      spritesheetFilename: 'momo.webp',
      importedAt: 10,
      updatedAt: 20,
    }),
    assetPath: `pets/momo/${REVISION}/spritesheet.webp`,
    spritesheetBase64: 'c3ByaXRl',
  } as const;
  if (importedPet) settings.activePetId = pet.id;
  return {
    schemaVersion: 1,
    settingsJson: JSON.stringify(settings),
    historyJson: [],
    pets: importedPet ? [pet] : [],
    overlay: {
      xRatio: 0.5,
      yRatio: 0.5,
      ...(importedPet ? { activePet: pet } : {}),
    },
  };
}

function send(detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', { detail })));
}

afterEach(() => {
  delete window.AndroidOverlay;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('announces overlay-ready exactly once across StrictMode replay and remount', () => {
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };

  const first = render(<StrictMode><AndroidOverlayApp /></StrictMode>);
  first.unmount();
  render(<StrictMode><AndroidOverlayApp /></StrictMode>);

  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledWith('{"type":"overlay-ready"}');
});

test('routes pet, legacy pet, detached surface, and default Android entries without overlap', () => {
  const isAndroidPetOverlayRoute = (
    androidOverlayModule as typeof androidOverlayModule & {
      isAndroidPetOverlayRoute?: (search: string) => boolean;
    }
  ).isAndroidPetOverlayRoute;

  expect(isAndroidPetOverlayRoute?.('?overlay=pet')).toBe(true);
  expect(isAndroidPetOverlayRoute?.('?overlay=1')).toBe(true);
  expect(isAndroidPetOverlayRoute?.('?overlay=surface')).toBe(false);
  expect(isAndroidPetOverlayRoute?.('')).toBe(false);
  expect(isAndroidDetachedSurfaceRoute('?overlay=surface')).toBe(true);
  expect(isAndroidDetachedSurfaceRoute('?overlay=pet')).toBe(false);
  expect(isAndroidDetachedSurfaceRoute('?overlay=1')).toBe(false);
  expect(isAndroidDetachedSurfaceRoute('')).toBe(false);
});

test('ignores legacy menu and bubble events without mounting surface DOM or sending surface messages', () => {
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };
  render(<AndroidOverlayApp />);

  send({ type: 'state-changed', snapshot: snapshotFor({ reminderDue: true }) });
  send({ type: 'open-menu', side: 'right', generation: 4 });
  send({ type: 'show-reminder', side: 'left', generation: 5 });

  expect(screen.getByTestId('android-pet')).toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(postMessage.mock.calls.map(([message]) => JSON.parse(message as string).type))
    .toSatisfy((types: string[]) => types.every((type) => type === 'overlay-ready'));
});

test('preserves the last valid pet snapshot when a later native snapshot is unsupported', () => {
  window.AndroidOverlay = { postMessage: vi.fn() };
  render(<AndroidOverlayApp />);

  send({ type: 'state-changed', snapshot: snapshotFor({ size: 'large' }) });
  const pet = screen.getByTestId('android-pet');
  expect(pet).toHaveStyle('--android-pet-size: 96px');

  send({ type: 'state-changed', snapshot: { schemaVersion: 99 } });

  expect(screen.getByTestId('android-pet')).toBe(pet);
  expect(pet).toHaveStyle('--android-pet-size: 96px');
});

test('uses native pet events for animation and cleans its timer and listener on unmount', () => {
  vi.useFakeTimers();
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };
  const addEventListener = vi.spyOn(window, 'addEventListener');
  const removeEventListener = vi.spyOn(window, 'removeEventListener');
  const setTimeout = vi.spyOn(window, 'setTimeout');
  const clearTimeout = vi.spyOn(window, 'clearTimeout');
  const view = render(<AndroidOverlayApp />);
  const overlayListener = addEventListener.mock.calls
    .find(([type]) => type === 'android-overlay-message')?.[1];

  send({ type: 'state-changed', snapshot: snapshotFor({ importedPet: true }) });
  const pet = screen.getByTestId('android-pet');
  postMessage.mockClear();

  fireEvent.click(pet);
  fireEvent.doubleClick(pet);
  expect(postMessage).not.toHaveBeenCalled();

  send({ type: 'pet-tap' });
  expect(pet).toHaveAttribute('data-animation', 'waving');
  const firstTapTimerIndex = setTimeout.mock.calls.findIndex(([, delay]) => delay === 1_500);
  expect(firstTapTimerIndex).toBeGreaterThanOrEqual(0);
  act(() => vi.advanceTimersByTime(1_500));
  expect(pet).toHaveAttribute('data-animation', 'idle');

  send({ type: 'pet-drag-start', facing: 'right' });
  expect(pet).toHaveAttribute('data-animation', 'running-right');
  send({ type: 'pet-drag-move', facing: 'left' });
  expect(pet).toHaveAttribute('data-animation', 'running-left');
  send({ type: 'pet-drag-end' });
  expect(pet).toHaveAttribute('data-animation', 'idle');

  send({ type: 'pet-tap' });
  const timerDelays = setTimeout.mock.calls.map(([, delay]) => delay);
  const finalTapTimerIndex = timerDelays.lastIndexOf(1_500);
  const finalTapTimer = setTimeout.mock.results[finalTapTimerIndex]?.value;
  view.unmount();

  expect(clearTimeout).toHaveBeenCalledWith(finalTapTimer);
  expect(removeEventListener).toHaveBeenCalledWith('android-overlay-message', overlayListener);
});
