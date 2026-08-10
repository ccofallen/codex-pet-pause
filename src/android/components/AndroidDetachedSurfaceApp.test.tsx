import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { Reminder } from '../../features/reminders/domain/types';
import type { AndroidHostSnapshot } from '../bridge/androidHost';
import {
  AndroidDetachedSurfaceApp,
  isAndroidDetachedSurfaceRoute,
} from './AndroidDetachedSurfaceApp';

const NOW = Date.UTC(2026, 7, 10, 9);

function dueReminder(id: 'lookAway' | 'drinkWater' = 'lookAway'): Reminder {
  return {
    id,
    kind: 'preset',
    type: id,
    enabled: true,
    intervalMinutes: 20,
    nextDueAt: NOW,
    status: 'due',
  };
}

function snapshotFor(reminders: Reminder[] = [], locale: 'en' | 'zh-CN' = 'en'): AndroidHostSnapshot {
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

function send(detail: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('android-overlay-message', { detail })));
}

function setSurfaceIdentity(mode: 'MENU' | 'BUBBLE', generation: number, instance = `test-${generation}`) {
  window.history.replaceState(
    {},
    '',
    `?overlay=surface&mode=${mode}&generation=${generation}&instance=${instance}`,
  );
}

function renderSurface(mode: 'MENU' | 'BUBBLE', generation: number) {
  setSurfaceIdentity(mode, generation);
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };
  render(<AndroidDetachedSurfaceApp />);
  return { postMessage };
}

afterEach(() => {
  delete window.AndroidOverlay;
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

test('routes only the detached surface query to the surface-only Android entry', () => {
  expect(isAndroidDetachedSurfaceRoute('?overlay=surface')).toBe(true);
  expect(isAndroidDetachedSurfaceRoute('?overlay=1')).toBe(false);
  expect(isAndroidDetachedSurfaceRoute('')).toBe(false);
});

test('does not announce readiness without one strict authoritative mode and generation', () => {
  window.history.replaceState({}, '', '?overlay=surface&mode=MENU');
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };

  render(<AndroidDetachedSurfaceApp />);

  expect(postMessage).not.toHaveBeenCalled();
});

test('mounts without pet DOM and announces typed readiness once under StrictMode', () => {
  setSurfaceIdentity('MENU', 19, 'strict-mode');
  const postMessage = vi.fn();
  window.AndroidOverlay = { postMessage };
  render(<StrictMode><AndroidDetachedSurfaceApp /></StrictMode>);

  expect(screen.queryByTestId('android-pet')).not.toBeInTheDocument();
  expect(screen.queryByTestId('cat-sprite')).not.toBeInTheDocument();
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-ready","mode":"MENU","generation":19}');
});

test('sends every menu action for the active generation', async () => {
  const user = userEvent.setup();
  const { postMessage } = renderSurface('MENU', 7);
  send({ type: 'state-changed', snapshot: snapshotFor() });
  send({ type: 'open-menu', mode: 'MENU', side: 'right', generation: 7 });

  const menu = screen.getByRole('menu');
  await user.click(within(menu).getByRole('button', { name: 'Close' }));
  await user.click(within(menu).getByRole('menuitem', { name: 'Settings' }));
  await user.click(within(menu).getByRole('menuitem', { name: 'Hide' }));
  await user.click(within(menu).getByRole('menuitem', { name: 'Quit' }));

  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":7,"action":"close"}');
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":7,"action":"settings"}');
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":7,"action":"hide"}');
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":7,"action":"quit"}');
});

test('sends bubble completion, skip, and snooze actions with the reminder id', async () => {
  const user = userEvent.setup();
  const completion = renderSurface('BUBBLE', 3);
  send({ type: 'state-changed', snapshot: snapshotFor([dueReminder()]) });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'left', generation: 3 });

  const bubble = screen.getByRole('dialog', { name: 'Look into the distance reminder' });
  await user.click(within(bubble).getByRole('button', { name: 'Do it now' }));
  await user.click(within(bubble).getByRole('button', { name: 'Done' }));
  expect(completion.postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"BUBBLE","generation":3,"action":"complete","reminderId":"lookAway"}');

  completion.postMessage.mockClear();
  const skipped = renderSurface('BUBBLE', 4);
  send({ type: 'state-changed', snapshot: snapshotFor([dueReminder()]) });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'left', generation: 4 });
  await user.click(screen.getAllByRole('button', { name: 'Skip' }).at(-1)!);
  expect(skipped.postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"BUBBLE","generation":4,"action":"skip","reminderId":"lookAway"}');

  const snoozed = renderSurface('BUBBLE', 5);
  send({ type: 'state-changed', snapshot: snapshotFor([dueReminder()]) });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'left', generation: 5 });
  await user.click(screen.getAllByRole('button', { name: 'Remind me later' }).at(-1)!);
  await user.click(screen.getAllByRole('button', { name: '10 minutes' }).at(-1)!);
  expect(snoozed.postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"BUBBLE","generation":5,"action":"snooze","reminderId":"lookAway","snoozeMinutes":10}');
});

test('reports positive intrinsic dimensions for the active surface', () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 304.1,
    height: 247.2,
    top: 0,
    right: 304.1,
    bottom: 247.2,
    left: 0,
    toJSON: () => undefined,
  } as DOMRect);
  const { postMessage } = renderSurface('MENU', 4);
  send({ type: 'state-changed', snapshot: snapshotFor() });
  send({ type: 'open-menu', mode: 'MENU', side: 'left', generation: 4 });

  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-size-changed","mode":"MENU","generation":4,"widthDp":305,"heightDp":248}');
});

test('ignores stale close messages for a newer generation', async () => {
  const user = userEvent.setup();
  const { postMessage } = renderSurface('MENU', 2);
  send({ type: 'state-changed', snapshot: snapshotFor() });
  send({ type: 'open-menu', mode: 'MENU', side: 'left', generation: 1 });
  send({ type: 'open-menu', mode: 'MENU', side: 'right', generation: 2 });
  send({ type: 'close-surface', mode: 'MENU', generation: 1 });

  expect(screen.getByRole('menu')).toBeVisible();
  await user.click(screen.getByRole('menuitem', { name: 'Hide' }));
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":2,"action":"hide"}');
});

test('ignores an older open message after a newer surface is active', async () => {
  const user = userEvent.setup();
  const { postMessage } = renderSurface('MENU', 9);
  send({ type: 'state-changed', snapshot: snapshotFor() });
  send({ type: 'open-menu', mode: 'MENU', side: 'left', generation: 9 });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'right', generation: 8 });

  expect(screen.getByRole('menu')).toBeVisible();
  await user.click(screen.getByRole('menuitem', { name: 'Hide' }));
  expect(postMessage).toHaveBeenCalledWith('{"type":"surface-action","mode":"MENU","generation":9,"action":"hide"}');
});

test('rejects malformed native messages without rendering a surface', () => {
  renderSurface('MENU', 1);
  send({ type: 'state-changed', snapshot: { schemaVersion: 99 } });
  send({ type: 'open-menu', mode: 'BUBBLE', side: 'left', generation: 1 });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'centre', generation: 1 });
  send({ type: 'open-menu', mode: 'MENU', side: 'left', generation: -1 });
  send({ type: 'close-surface', mode: 'MENU', generation: 0.5 });

  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('rejects a different mode with the authoritative generation', () => {
  renderSurface('MENU', 12);
  send({ type: 'state-changed', snapshot: snapshotFor([dueReminder()]) });
  send({ type: 'open-menu', mode: 'MENU', side: 'left', generation: 12 });
  send({ type: 'show-reminder', mode: 'BUBBLE', side: 'right', generation: 12 });

  expect(screen.getByRole('menu')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
