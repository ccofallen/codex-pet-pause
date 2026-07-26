import {
  createContext, type PropsWithChildren, useContext, useEffect, useMemo, useRef,
  useSyncExternalStore,
} from 'react';
import type { AppController } from './appController';
import type { AppSnapshot } from './model';
import { startBrowserLifecycle } from '../infrastructure/browserLifecycle';
import { SETTINGS_KEY } from '../infrastructure/settingsRepository';
import {
  createRendererSynchronization,
  type RendererSynchronization,
} from '../infrastructure/rendererSynchronization';
import { SETTINGS_CONFLICT_RECOVERED_EVENT } from '../infrastructure/synchronizedSettingsRepository';

const AppControllerContext = createContext<AppController | undefined>(undefined);
const AppSnapshotContext = createContext<AppSnapshot | undefined>(undefined);

export type AppProviderLifecycle = 'authoritative' | 'passive';

interface AppProviderProps extends PropsWithChildren {
  controller: AppController;
  lifecycle?: AppProviderLifecycle;
}

function createPassiveController(
  controller: AppController,
  synchronization: Pick<RendererSynchronization, 'notify'>,
): AppController {
  const synchronize = <Args extends unknown[], Result,>(
    operation: (...args: Args) => Promise<Result>,
  ) => async (...args: Args): Promise<Result> => {
    const result = await operation(...args);
    synchronization.notify();
    return result;
  };

  return {
    ...controller,
    complete: synchronize(controller.complete),
    snooze: synchronize(controller.snooze),
    skip: synchronize(controller.skip),
    pause: synchronize(controller.pause),
    resumePause: synchronize(controller.resumePause),
    setLocale: synchronize(controller.setLocale),
    saveSettings: synchronize(controller.saveSettings),
    savePet: synchronize(controller.savePet),
    deletePet: synchronize(controller.deletePet),
    selectPet: synchronize(controller.selectPet),
    savePetPosition: synchronize(controller.savePetPosition),
    requestNotifications: synchronize(controller.requestNotifications),
    clearAll: synchronize(controller.clearAll),
  };
}

export function AppProvider({
  controller,
  children,
  lifecycle = 'authoritative',
}: AppProviderProps) {
  const hydrationRef = useRef<{ controller: AppController; promise: Promise<void> } | undefined>(undefined);
  const synchronizationRef = useRef<Pick<RendererSynchronization, 'notify'> | undefined>(undefined);
  const pendingSynchronizationRef = useRef(false);
  const providedController = useMemo(
    () => lifecycle === 'passive'
      ? createPassiveController(controller, {
        notify: () => {
          const synchronization = synchronizationRef.current;
          if (synchronization === undefined) pendingSynchronizationRef.current = true;
          else synchronization.notify();
        },
      })
      : controller,
    [controller, lifecycle],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    let stopped = false;
    let reloading = false;
    let requestedGeneration = 1;
    let completedGeneration = 0;
    let initialHydration = true;
    let latestHydrationSucceeded = false;
    let stopLifecycle: (() => void) | undefined;
    let activeReconciliation: Promise<void> | undefined;
    const synchronization = createRendererSynchronization();
    synchronizationRef.current = synchronization;
    if (pendingSynchronizationRef.current) {
      pendingSynchronizationRef.current = false;
      synchronization.notify();
    }
    if (hydrationRef.current?.controller !== controller) {
      hydrationRef.current = { controller, promise: controller.hydrate() };
    }
    const firstHydration = hydrationRef.current.promise;

    const reconcile = (): Promise<void> => {
      const pending = controller.reconcileNow();
      const tracked = pending.finally(() => {
        if (activeReconciliation === tracked) activeReconciliation = undefined;
      });
      activeReconciliation = tracked;
      return tracked;
    };

    const lifecycleController = {
      getSnapshot: controller.getSnapshot,
      subscribe: controller.subscribe,
      reconcileNow: reconcile,
    };

    const reload = async (): Promise<void> => {
      if (reloading) return;
      reloading = true;
      stopLifecycle?.();
      stopLifecycle = undefined;

      while (completedGeneration < requestedGeneration && !stopped) {
        await activeReconciliation?.catch(() => undefined);
        if (stopped) continue;
        const generation = requestedGeneration;
        const isInitialHydration = initialHydration;
        const hydration = initialHydration ? firstHydration : controller.hydrate();
        initialHydration = false;
        try {
          await hydration;
        } catch {
          if (generation === requestedGeneration) {
            completedGeneration = generation;
            latestHydrationSucceeded = false;
          }
          continue;
        }
        if (stopped || generation !== requestedGeneration) continue;
        latestHydrationSucceeded = true;
        if (lifecycle === 'authoritative' && isInitialHydration) {
          try {
            await reconcile();
          } catch {
            // A later lifecycle trigger can retry a transient reconciliation failure.
          }
          if (stopped || generation !== requestedGeneration) continue;
        }
        completedGeneration = generation;
      }

      if (!stopped && lifecycle === 'authoritative' && latestHydrationSucceeded) {
        stopLifecycle = startBrowserLifecycle(lifecycleController);
      }
      reloading = false;
    };

    const requestReload = (): void => {
      requestedGeneration += 1;
      void reload();
    };
    const unsubscribeSynchronization = lifecycle === 'authoritative'
      ? synchronization.subscribe(requestReload)
      : () => undefined;
    const onStorage = (event: StorageEvent): void => {
      if (lifecycle === 'passive' && event.key === SETTINGS_KEY) requestReload();
    };
    const onConflictRecovered = (): void => {
      if (lifecycle === 'passive') requestReload();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(SETTINGS_CONFLICT_RECOVERED_EVENT, onConflictRecovered);
    void reload();

    return () => {
      stopped = true;
      stopLifecycle?.();
      unsubscribeSynchronization();
      synchronization.close();
      if (synchronizationRef.current === synchronization) {
        synchronizationRef.current = undefined;
      }
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SETTINGS_CONFLICT_RECOVERED_EVENT, onConflictRecovered);
    };
  }, [controller, lifecycle]);

  return (
    <AppControllerContext value={providedController}>
      <AppSnapshotContext value={snapshot}>{children}</AppSnapshotContext>
    </AppControllerContext>
  );
}

export function useAppController(): AppController {
  const controller = useContext(AppControllerContext);
  if (controller === undefined) {
    throw new Error('useAppController must be used within AppProvider');
  }
  return controller;
}

export function useAppSnapshot(): AppSnapshot {
  const snapshot = useContext(AppSnapshotContext);
  if (snapshot === undefined) {
    throw new Error('useAppSnapshot must be used within AppProvider');
  }
  return snapshot;
}
