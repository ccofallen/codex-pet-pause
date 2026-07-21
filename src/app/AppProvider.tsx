import {
  createContext, type PropsWithChildren, useContext, useEffect, useRef, useSyncExternalStore,
} from 'react';
import type { AppController } from './appController';
import type { AppSnapshot } from './model';
import { startBrowserLifecycle } from '../infrastructure/browserLifecycle';

const AppControllerContext = createContext<AppController | undefined>(undefined);
const AppSnapshotContext = createContext<AppSnapshot | undefined>(undefined);

interface AppProviderProps extends PropsWithChildren {
  controller: AppController;
}

export function AppProvider({ controller, children }: AppProviderProps) {
  const hydrationRef = useRef<{ controller: AppController; promise: Promise<void> } | undefined>(undefined);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    let stopped = false;
    let stopLifecycle: (() => void) | undefined;
    if (hydrationRef.current?.controller !== controller) {
      hydrationRef.current = { controller, promise: controller.hydrate() };
    }
    void hydrationRef.current.promise.then(async () => {
      if (stopped) return;
      try {
        await controller.reconcileNow();
      } catch {
        // Hydration succeeded; later lifecycle triggers can retry a transient reconciliation failure.
      }
      if (!stopped) stopLifecycle = startBrowserLifecycle(controller);
    }).catch(() => undefined);
    return () => {
      stopped = true;
      stopLifecycle?.();
    };
  }, [controller]);

  return (
    <AppControllerContext value={controller}>
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
