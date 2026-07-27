import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';
import { createDefaultSettings } from './defaults';
import { createAppController, type AppController } from './appController';
import type { AppSettings, AppSnapshot } from './model';
import { AppProvider, useAppController, useAppSnapshot } from './AppProvider';
import { createFakeDependencies } from '../test/fakes';
import { MURK_TEST_PET } from '../test/petFixtures';
import { SETTINGS_KEY, type SettingsRepository } from '../infrastructure/settingsRepository';
import { createSynchronizedSettingsRepository } from '../infrastructure/synchronizedSettingsRepository';

const RENDERER_STATE_SYNC_KEY = 'neko-pause:renderer-state-sync';

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

test('passive settings providers hydrate without reconciling or starting reminder lifecycle', async () => {
  const controller = createFakeController();
  const view = render(
    <AppProvider controller={controller} lifecycle="passive"><Consumer /></AppProvider>,
  );

  await act(async () => undefined);

  expect(controller.hydrate).toHaveBeenCalledTimes(1);
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  view.unmount();
});

test('authoritative providers reload persisted renderer changes before resuming lifecycle', async () => {
  const controller = createFakeController();
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(1));

  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));

  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('skips reconciliation for a hydration invalidated by a newer renderer change', async () => {
  const controller = createFakeController();
  let finishStaleHydration!: () => void;
  controller.hydrate = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishStaleHydration = resolve; }))
    .mockResolvedValueOnce(undefined);
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(1));

  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  finishStaleHydration();

  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(3));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('waits for an in-flight reconciliation and hydrates only the latest sync generation', async () => {
  const revisionKey = 'neko-pause:settings-revision';
  window.localStorage.removeItem(revisionKey);
  let persisted = createDefaultSettings(100);
  const baseRepository = (): SettingsRepository => ({
    load: async () => persisted,
    save: async (settings: AppSettings) => { persisted = settings; },
    clear: async () => undefined,
  });
  const authorityRepository = createSynchronizedSettingsRepository(
    baseRepository(),
    window.localStorage,
  );
  const settingsRepository = createSynchronizedSettingsRepository(
    baseRepository(),
    window.localStorage,
  );
  const staleSettings = (await authorityRepository.load())!;
  const latestSettings = { ...(await settingsRepository.load())!, theme: 'dark' as const };
  const controller = createFakeController();
  let finishReconciliation!: () => void;
  controller.hydrate = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined);
  controller.reconcileNow = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finishReconciliation = () => {
        void authorityRepository.save(staleSettings).then(resolve, reject);
      };
    }));
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(1));

  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(2));
  await settingsRepository.save(latestSettings);
  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  expect(controller.hydrate).toHaveBeenCalledTimes(1);

  finishReconciliation();
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  expect(persisted.theme).toBe('dark');
  view.unmount();
  window.localStorage.removeItem(revisionKey);
});

test('does not restart lifecycle after the latest hydration fails', async () => {
  const controller = createFakeController();
  controller.hydrate = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('load failed'))
    .mockResolvedValueOnce(undefined);
  const view = render(<AppProvider controller={controller}><Consumer /></AppProvider>);
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(1));

  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  await act(async () => undefined);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(3));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('passive settings providers reload authoritative reminder state without reconciling it', async () => {
  const controller = createFakeController();
  const view = render(
    <AppProvider controller={controller} lifecycle="passive"><Consumer /></AppProvider>,
  );
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(1));

  window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));

  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  view.unmount();
});

test('passive settings providers hydrate the repository result after conflict recovery', async () => {
  const controller = createFakeController();
  const view = render(
    <AppProvider controller={controller} lifecycle="passive"><Consumer /></AppProvider>,
  );
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(1));

  window.dispatchEvent(new Event('neko-pause:settings-conflict-recovered'));

  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  expect(controller.reconcileNow).not.toHaveBeenCalled();
  view.unmount();
});

test('passive settings providers signal imported pets after persistence completes', async () => {
  window.localStorage.removeItem(RENDERER_STATE_SYNC_KEY);
  const controller = createFakeController();
  let finishSave!: () => void;
  controller.savePet = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
  let providedController!: AppController;

  function CaptureController() {
    providedController = useAppController();
    return null;
  }

  const view = render(
    <AppProvider controller={controller} lifecycle="passive">
      <CaptureController />
    </AppProvider>,
  );
  const savePromise = providedController.savePet(MURK_TEST_PET);

  expect(window.localStorage.getItem(RENDERER_STATE_SYNC_KEY)).toBeNull();
  finishSave();
  await act(async () => savePromise);
  expect(controller.savePet).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(RENDERER_STATE_SYNC_KEY)).not.toBeNull();
  view.unmount();
  window.localStorage.removeItem(RENDERER_STATE_SYNC_KEY);
});

test('keeps passive mutations usable when renderer synchronization storage fails', async () => {
  const controller = createFakeController();
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'QuotaExceededError');
  });
  let providedController!: AppController;

  function CaptureController() {
    providedController = useAppController();
    return null;
  }

  const view = render(
    <AppProvider controller={controller} lifecycle="passive">
      <CaptureController />
    </AppProvider>,
  );
  await expect(providedController.savePet(MURK_TEST_PET)).resolves.toBeUndefined();
  expect(controller.savePet).toHaveBeenCalledTimes(1);
  view.unmount();
  setItem.mockRestore();
});

test('BroadcastChannel converges the authority when storage signaling fails', async () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  class FakeBroadcastChannel {
    static instances = new Set<FakeBroadcastChannel>();
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(readonly name: string) {
      FakeBroadcastChannel.instances.add(this);
    }

    postMessage(data: unknown): void {
      for (const instance of FakeBroadcastChannel.instances) {
        if (instance !== this && instance.name === this.name && !instance.closed) {
          queueMicrotask(() => instance.onmessage?.({ data } as MessageEvent));
        }
      }
    }

    close(): void {
      this.closed = true;
      FakeBroadcastChannel.instances.delete(this);
    }
  }
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: FakeBroadcastChannel,
  });
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'QuotaExceededError');
  });
  const authority = createFakeController();
  const settings = createFakeController();
  let settingsController!: AppController;

  function CaptureSettingsController() {
    settingsController = useAppController();
    return null;
  }

  const authorityView = render(<AppProvider controller={authority}><Consumer /></AppProvider>);
  const settingsView = render(
    <AppProvider controller={settings} lifecycle="passive">
      <CaptureSettingsController />
    </AppProvider>,
  );
  await waitFor(() => expect(authority.reconcileNow).toHaveBeenCalledTimes(1));

  await settingsController.savePet(MURK_TEST_PET);

  await waitFor(() => expect(authority.hydrate).toHaveBeenCalledTimes(2));
  expect(authority.reconcileNow).toHaveBeenCalledTimes(1);
  authorityView.unmount();
  settingsView.unmount();
  expect([...FakeBroadcastChannel.instances]).toHaveLength(0);
  setItem.mockRestore();
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: originalBroadcastChannel,
  });
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

test('StrictMode keeps one synchronization listener and removes it with lifecycle cleanup', async () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  class CleanupBroadcastChannel {
    static instances = new Set<CleanupBroadcastChannel>();
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(readonly name: string) {
      CleanupBroadcastChannel.instances.add(this);
    }

    postMessage(): void {
      // This test exercises ownership and cleanup only.
    }

    close(): void {
      CleanupBroadcastChannel.instances.delete(this);
    }
  }
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: CleanupBroadcastChannel,
  });
  const controller = createFakeController();
  const view = render(
    <StrictMode>
      <AppProvider controller={controller}><Consumer /></AppProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(controller.reconcileNow).toHaveBeenCalledTimes(1));
  expect([...CleanupBroadcastChannel.instances]).toHaveLength(1);

  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  await waitFor(() => expect(controller.hydrate).toHaveBeenCalledTimes(2));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);

  view.unmount();
  window.dispatchEvent(new StorageEvent('storage', { key: RENDERER_STATE_SYNC_KEY }));
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => undefined);
  expect(controller.hydrate).toHaveBeenCalledTimes(2);
  expect(controller.reconcileNow).toHaveBeenCalledTimes(2);
  expect([...CleanupBroadcastChannel.instances]).toHaveLength(0);
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: originalBroadcastChannel,
  });
});

test('hooks throw descriptive errors outside AppProvider', () => {
  expect(() => render(<Consumer />)).toThrow('useAppController must be used within AppProvider');
});
