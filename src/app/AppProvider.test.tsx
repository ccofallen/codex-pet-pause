import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';
import { createDefaultSettings } from './defaults';
import { createAppController, type AppController } from './appController';
import type { AppSnapshot } from './model';
import { AppProvider, useAppController, useAppSnapshot } from './AppProvider';
import { createFakeDependencies } from '../test/fakes';

function createFakeController(): AppController {
  const settings = createDefaultSettings(0);
  const snapshot: AppSnapshot = {
    ready: false,
    settings,
    scheduler: { reminders: settings.reminders, dueQueue: [] },
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

function Consumer() {
  const controller = useAppController();
  const snapshot = useAppSnapshot();
  return <p>{snapshot.ready ? 'ready' : controller.getSnapshot().settings.cat.name}</p>;
}

test('provides the controller and snapshot, hydrates, and owns browser lifecycle cleanup', async () => {
  const controller = createFakeController();
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);
  expect(screen.getByText('Momo')).toBeInTheDocument();
  expect(controller.hydrate).toHaveBeenCalledTimes(1);

  await act(async () => undefined);

  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);

  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  view.unmount();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
});

test('does not start lifecycle reconciliation until hydration finishes', async () => {
  const controller = createFakeController();
  let finishHydration!: () => void;
  controller.hydrate = vi.fn(() => new Promise<void>((resolve) => { finishHydration = resolve; }));
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);

  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).not.toHaveBeenCalled();

  finishHydration();
  await act(async () => undefined);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('reconciles persisted overdue reminders and expired suppression immediately after hydration', async () => {
  const now = new Date(2026, 6, 11, 9).getTime();
  const settings = createDefaultSettings(now);
  settings.onboardingComplete = true;
  settings.quietHours = { enabled: true, startMinutes: 7 * 60, endMinutes: 8 * 60 };
  settings.runtime = {
    quietStartedAt: new Date(2026, 6, 11, 7).getTime(),
    pausedAt: new Date(2026, 6, 11, 7, 15).getTime(),
    pausedUntil: new Date(2026, 6, 11, 7, 45).getTime(),
  };
  settings.reminders[0] = {
    ...settings.reminders[0]!,
    enabled: true,
    status: 'scheduled',
    nextDueAt: new Date(2026, 6, 11, 5).getTime(),
  };
  const deps = createFakeDependencies({ now, settings });
  const controller = createAppController(deps);

  render(<AppProvider controller={controller}><Consumer /></AppProvider>);

  await waitFor(() => expect(controller.getSnapshot().scheduler.dueQueue.map(({ reminderId }) => reminderId))
    .toEqual(['lookAway']));
  expect(controller.getSnapshot().scheduler).toMatchObject({
    pausedAt: undefined,
    pausedUntil: undefined,
    quietStartedAt: undefined,
  });
  expect(deps.notifications.deliveries).toEqual([{
    title: '喵',
    body: '该目视远方了。',
    tag: 'neko-pause-reminder',
  }]);
});

test('hydrates a controller once when React StrictMode replays effects', () => {
  const controller = createFakeController();
  render(
    <StrictMode>
      <AppProvider controller={controller}><Consumer /></AppProvider>
    </StrictMode>,
  );

  expect(controller.hydrate).toHaveBeenCalledTimes(1);
});

test('hooks throw descriptive errors outside AppProvider', () => {
  expect(() => render(<Consumer />)).toThrow('useAppController must be used within AppProvider');
});
