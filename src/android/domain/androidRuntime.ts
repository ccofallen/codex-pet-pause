import type { AppProviderLifecycle } from '../../app/AppProvider';
import type { AndroidHostEvent } from '../bridge/androidHost';
import {
  createOrderedAndroidRuntimeRefresh,
  type AndroidRuntimeRefresh,
} from '../infrastructure/androidRuntimeRepository';
import type { AndroidRuntimeState } from './runtimeSnapshot';

export const androidAppProviderLifecycle: AppProviderLifecycle = 'passive';

export interface CoalescedAndroidRuntimeSignalRefresh {
  signal(revision: number): void;
  dispose(): void;
}

export function createCoalescedAndroidRuntimeSignalRefresh(
  invalidate: (revision: number) => boolean,
  refresh: () => Promise<void>,
): CoalescedAndroidRuntimeSignalRefresh {
  let pendingRevision = -1;
  let scheduled = false;
  let active = false;
  let disposed = false;

  const schedule = (): void => {
    if (disposed || scheduled || active || pendingRevision < 0) return;
    scheduled = true;
    queueMicrotask(() => { void drain(); });
  };

  const drain = async (): Promise<void> => {
    scheduled = false;
    if (disposed || active || pendingRevision < 0) return;
    const revisionToLoad = pendingRevision;
    pendingRevision = -1;
    if (!invalidate(revisionToLoad)) {
      schedule();
      return;
    }
    active = true;
    try {
      await refresh();
    } finally {
      active = false;
      schedule();
    }
  };

  return {
    signal(revision): void {
      if (disposed || !Number.isSafeInteger(revision) || revision < 0) return;
      pendingRevision = Math.max(pendingRevision, revision);
      schedule();
    },
    dispose(): void {
      disposed = true;
      pendingRevision = -1;
    },
  };
}

interface AndroidRuntimeEventConnection {
  subscribe(listener: (event: AndroidHostEvent) => void): () => void;
  invalidateLegacy(): void;
  invalidateRuntime(revision: number): boolean;
  load(): Promise<AndroidRuntimeState | null>;
  apply(state: AndroidRuntimeState): void;
}

export function connectAndroidRuntimeEvents({
  subscribe,
  invalidateLegacy,
  invalidateRuntime,
  load,
  apply,
}: AndroidRuntimeEventConnection): () => void {
  const refresh: AndroidRuntimeRefresh = createOrderedAndroidRuntimeRefresh(load, apply);
  const signals = createCoalescedAndroidRuntimeSignalRefresh(invalidateRuntime, refresh);
  const unsubscribe = subscribe((event) => {
    if (event.type === 'runtimeStateChanged') {
      signals.signal(event.revision);
      return;
    }
    invalidateLegacy();
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    signals.dispose();
    refresh.dispose();
  };
}
