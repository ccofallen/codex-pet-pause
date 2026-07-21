import { afterEach, expect, test, vi } from 'vitest';
import {
  createPwaStatusStore,
  pwaStatus,
  registerPwaServiceWorker,
  resetPwaRegistrationStateForTests,
} from './pwaStatus';

const registerSW = vi.hoisted(() => vi.fn());

vi.mock('virtual:pwa-register', () => ({ registerSW }));

type RegistrationCallbacks = {
  onOfflineReady(): void;
  onNeedRefresh(): void;
  onRegisterError(error: Error): void;
  onRegisteredSW(scriptUrl: string, registration: ServiceWorkerRegistration | undefined): void;
};

function installServiceWorker(controller: ServiceWorker | null = null): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller },
  });
}

async function captureRegistration(): Promise<{
  callbacks: RegistrationCallbacks;
  registration: Promise<void>;
}> {
  let callbacks: RegistrationCallbacks | undefined;
  registerSW.mockImplementation((options) => {
    callbacks = options;
    return vi.fn().mockResolvedValue(undefined);
  });
  const registration = registerPwaServiceWorker();
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalledOnce());
  return { callbacks: callbacks!, registration };
}

afterEach(() => {
  resetPwaRegistrationStateForTests();
  pwaStatus.reset();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  registerSW.mockReset();
});

test('keeps registration and update errors in independent domains', () => {
  const store = createPwaStatusStore();
  store.markRegistrationError();
  store.markUpdateAvailable();
  expect(store.getSnapshot()).toMatchObject({
    offlineReady: false,
    updateAvailable: true,
    registrationError: 'registration-unavailable',
  });
  expect(store.getSnapshot().updateError).toBeUndefined();

  store.connectUpdate(vi.fn().mockRejectedValue(new Error('network')));
  return store.applyUpdate().then(() => {
    expect(store.getSnapshot()).toMatchObject({
      registrationError: 'registration-unavailable',
      updateError: 'update-failed',
      updateAvailable: true,
    });
    store.markOfflineReady();
    expect(store.getSnapshot()).toMatchObject({
      offlineReady: true,
      updateError: 'update-failed',
    });
    expect(store.getSnapshot().registrationError).toBeUndefined();
  });
});

test('dismisses an update and clears only its error', async () => {
  const store = createPwaStatusStore();
  store.markRegistrationError();
  store.markUpdateAvailable();
  store.connectUpdate(vi.fn().mockRejectedValue(new Error('network')));
  await store.applyUpdate();

  store.dismissUpdate();
  expect(store.getSnapshot()).toMatchObject({
    updateAvailable: false,
    registrationError: 'registration-unavailable',
  });
  expect(store.getSnapshot().updateError).toBeUndefined();
});

test('captures a synchronous updater throw and permits a successful retry', async () => {
  const store = createPwaStatusStore();
  const update = vi.fn()
    .mockImplementationOnce(() => { throw new Error('sync'); })
    .mockResolvedValueOnce(undefined);
  store.connectUpdate(update);
  store.markUpdateAvailable();

  await expect(store.applyUpdate()).resolves.toBeUndefined();
  expect(store.getSnapshot()).toMatchObject({
    updateAvailable: true,
    updating: false,
    updateError: 'update-failed',
  });
  await store.applyUpdate();
  expect(update).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toMatchObject({
    updateAvailable: false,
    updating: false,
  });
  expect(store.getSnapshot().updateError).toBeUndefined();
});

test('applies an update as a single flight', async () => {
  let resolveUpdate!: () => void;
  const update = vi.fn(() => new Promise<void>((resolve) => { resolveUpdate = resolve; }));
  const store = createPwaStatusStore();
  store.connectUpdate(update);
  store.markUpdateAvailable();

  const first = store.applyUpdate();
  const second = store.applyUpdate();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(store.getSnapshot().updating).toBe(true);
  resolveUpdate();
  await Promise.all([first, second]);
  expect(store.getSnapshot()).toMatchObject({ updateAvailable: false, updating: false });
});

test('keeps the update prompt actionable when no updater is connected', async () => {
  const store = createPwaStatusStore();
  store.markUpdateAvailable();

  await expect(store.applyUpdate()).resolves.toBeUndefined();
  expect(store.getSnapshot()).toMatchObject({
    updateAvailable: true,
    updating: false,
    updateError: 'update-unavailable',
  });
});

test('reports offline capability unavailable when service workers are unsupported', async () => {
  await registerPwaServiceWorker();
  expect(registerSW).not.toHaveBeenCalled();
  expect(pwaStatus.getSnapshot()).toMatchObject({
    offlineReady: false,
    registrationError: 'registration-unavailable',
  });
});

test('first installation becomes ready only through onOfflineReady', async () => {
  installServiceWorker();
  const { callbacks, registration } = await captureRegistration();

  callbacks.onRegisteredSW('/sw.js', {} as ServiceWorkerRegistration);
  await registration;
  expect(pwaStatus.getSnapshot().offlineReady).toBe(false);

  callbacks.onOfflineReady();
  expect(pwaStatus.getSnapshot().offlineReady).toBe(true);
});

test('a new page restores readiness from an existing active service worker', async () => {
  installServiceWorker();
  const { callbacks, registration } = await captureRegistration();
  callbacks.onRegisteredSW('/sw.js', { active: {} } as ServiceWorkerRegistration);
  await registration;

  expect(pwaStatus.getSnapshot().offlineReady).toBe(true);
  expect(pwaStatus.getSnapshot().registrationError).toBeUndefined();
});

test('a controller restores readiness even when registration is unavailable', async () => {
  installServiceWorker({} as ServiceWorker);
  const { callbacks, registration } = await captureRegistration();
  callbacks.onRegisteredSW('/sw.js', undefined);
  await registration;

  expect(pwaStatus.getSnapshot().offlineReady).toBe(true);
});

test('an undefined registration without a controller does not claim readiness', async () => {
  installServiceWorker();
  const { callbacks, registration } = await captureRegistration();
  callbacks.onRegisteredSW('/sw.js', undefined);
  await registration;

  expect(pwaStatus.getSnapshot().offlineReady).toBe(false);
});

test('concurrent registration calls share one in-flight registration', async () => {
  installServiceWorker();
  const first = registerPwaServiceWorker();
  const second = registerPwaServiceWorker();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalledOnce());
  const callbacks = registerSW.mock.calls[0]![0] as RegistrationCallbacks;
  callbacks.onRegisteredSW('/sw.js', {} as ServiceWorkerRegistration);
  await Promise.all([first, second]);
});

test('waits for an asynchronous registration error and allows retry', async () => {
  installServiceWorker();
  const first = registerPwaServiceWorker();
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalledOnce());
  const firstCallbacks = registerSW.mock.calls[0]![0] as RegistrationCallbacks;
  firstCallbacks.onRegisterError(new Error('failed'));
  await first;
  expect(pwaStatus.getSnapshot().registrationError).toBe('registration-unavailable');

  const second = registerPwaServiceWorker();
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalledTimes(2));
  const secondCallbacks = registerSW.mock.calls[1]![0] as RegistrationCallbacks;
  secondCallbacks.onRegisteredSW('/sw.js', { active: {} } as ServiceWorkerRegistration);
  await second;
  expect(pwaStatus.getSnapshot().offlineReady).toBe(true);
  expect(pwaStatus.getSnapshot().registrationError).toBeUndefined();
});

test('preserves offline readiness when registration fails beside an existing controller', async () => {
  installServiceWorker({} as ServiceWorker);
  const { callbacks, registration } = await captureRegistration();
  callbacks.onRegisterError(new Error('refresh registration failed'));
  await registration;

  expect(pwaStatus.getSnapshot()).toMatchObject({
    offlineReady: true,
    registrationError: 'registration-unavailable',
  });
});

test('recovers after registerSW throws synchronously', async () => {
  installServiceWorker();
  registerSW.mockImplementationOnce(() => { throw new Error('sync'); });
  await expect(registerPwaServiceWorker()).resolves.toBeUndefined();
  expect(pwaStatus.getSnapshot().registrationError).toBe('registration-unavailable');

  const retry = registerPwaServiceWorker();
  await vi.waitFor(() => expect(registerSW).toHaveBeenCalledTimes(2));
  const callbacks = registerSW.mock.calls[1]![0] as RegistrationCallbacks;
  callbacks.onRegisteredSW('/sw.js', {} as ServiceWorkerRegistration);
  await retry;
});
