export type PwaErrorCode = 'registration-unavailable' | 'update-unavailable' | 'update-failed';

export interface PwaStatusSnapshot {
  offlineReady: boolean;
  updateAvailable: boolean;
  updating: boolean;
  registrationError?: PwaErrorCode;
  updateError?: PwaErrorCode;
}

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export interface PwaStatusStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PwaStatusSnapshot;
  markOfflineReady(): void;
  markUpdateAvailable(): void;
  markRegistrationError(): void;
  connectUpdate(update: UpdateServiceWorker): void;
  applyUpdate(): Promise<void>;
  dismissUpdate(): void;
  reset(): void;
}

const INITIAL_STATUS: PwaStatusSnapshot = {
  offlineReady: false,
  updateAvailable: false,
  updating: false,
};

export function createPwaStatusStore(): PwaStatusStore {
  let snapshot: PwaStatusSnapshot = { ...INITIAL_STATUS };
  let updateServiceWorker: UpdateServiceWorker | undefined;
  let updateFlight: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: PwaStatusSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const withoutRegistrationError = (): PwaStatusSnapshot => {
    const { registrationError: _registrationError, ...rest } = snapshot;
    return rest;
  };

  const withoutUpdateError = (): PwaStatusSnapshot => {
    const { updateError: _updateError, ...rest } = snapshot;
    return rest;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    markOfflineReady() {
      publish({ ...withoutRegistrationError(), offlineReady: true });
    },
    markUpdateAvailable() {
      publish({ ...withoutUpdateError(), updateAvailable: true });
    },
    markRegistrationError() {
      publish({ ...snapshot, registrationError: 'registration-unavailable' });
    },
    connectUpdate(update) {
      updateServiceWorker = update;
    },
    applyUpdate() {
      if (updateFlight !== undefined) return updateFlight;
      if (updateServiceWorker === undefined) {
        publish({ ...snapshot, updateError: 'update-unavailable' });
        return Promise.resolve();
      }

      publish({ ...withoutUpdateError(), updating: true });
      updateFlight = Promise.resolve()
        .then(() => updateServiceWorker!(true))
        .then(() => publish({ ...withoutUpdateError(), updateAvailable: false, updating: false }))
        .catch(() => publish({ ...snapshot, updating: false, updateError: 'update-failed' }))
        .finally(() => { updateFlight = undefined; });
      return updateFlight;
    },
    dismissUpdate() {
      if (!snapshot.updating) publish({ ...withoutUpdateError(), updateAvailable: false });
    },
    reset() {
      snapshot = { ...INITIAL_STATUS };
      updateServiceWorker = undefined;
      updateFlight = undefined;
      listeners.forEach((listener) => listener());
    },
  };
}

export const pwaStatus = createPwaStatusStore();

interface PwaRegistrationState {
  inFlight: Promise<void> | undefined;
  registered: boolean;
}

const registrationKey = '__nekoPausePwaRegistrationState__';
type RegistrationGlobal = typeof globalThis & {
  [registrationKey]?: PwaRegistrationState;
};

function getRegistrationState(): PwaRegistrationState {
  const registrationGlobal = globalThis as RegistrationGlobal;
  registrationGlobal[registrationKey] ??= { inFlight: undefined, registered: false };
  return registrationGlobal[registrationKey];
}

function preserveExistingOfflineReadiness(): void {
  if (navigator.serviceWorker.controller !== null
    && navigator.serviceWorker.controller !== undefined) {
    pwaStatus.markOfflineReady();
  }
}

export function resetPwaRegistrationStateForTests(): void {
  delete (globalThis as RegistrationGlobal)[registrationKey];
}

export function registerPwaServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return Promise.resolve();
  if (!('serviceWorker' in navigator)) {
    pwaStatus.markRegistrationError();
    return Promise.resolve();
  }

  const registrationState = getRegistrationState();
  if (registrationState.registered) return Promise.resolve();
  if (registrationState.inFlight !== undefined) return registrationState.inFlight;

  const registrationAttempt = import('virtual:pwa-register')
    .then(({ registerSW }) => new Promise<void>((resolve) => {
      let settled = false;
      const finish = (registered: boolean): void => {
        if (settled) return;
        settled = true;
        registrationState.registered = registered;
        resolve();
      };
      const fail = (): void => {
        preserveExistingOfflineReadiness();
        pwaStatus.markRegistrationError();
        finish(false);
      };

      try {
        const updateServiceWorker = registerSW({
          immediate: true,
          onOfflineReady: () => pwaStatus.markOfflineReady(),
          onNeedRefresh: () => pwaStatus.markUpdateAvailable(),
          onRegisteredSW: (_scriptUrl, registration) => {
            const hasActiveWorker = registration?.active !== null && registration?.active !== undefined;
            const hasController = navigator.serviceWorker.controller !== null
              && navigator.serviceWorker.controller !== undefined;
            if (hasActiveWorker || hasController) {
              pwaStatus.markOfflineReady();
            }
            finish(true);
          },
          onRegisterError: fail,
        });
        pwaStatus.connectUpdate(updateServiceWorker);
      } catch {
        fail();
      }
    }))
    .catch(() => {
      preserveExistingOfflineReadiness();
      pwaStatus.markRegistrationError();
      registrationState.registered = false;
    });

  let trackedAttempt: Promise<void>;
  trackedAttempt = registrationAttempt.finally(() => {
    if (registrationState.inFlight === trackedAttempt) registrationState.inFlight = undefined;
  });
  registrationState.inFlight = trackedAttempt;
  return trackedAttempt;
}
