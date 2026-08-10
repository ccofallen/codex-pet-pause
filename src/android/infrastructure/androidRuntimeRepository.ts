import type { AndroidHost } from '../bridge/androidHost';
import type { ActivityEvent } from '../../app/model';
import type { AndroidRuntimeState } from '../domain/runtimeSnapshot';

export interface AndroidRuntimeRepository {
  load(): Promise<AndroidRuntimeState | null>;
  invalidate(revision?: number): boolean;
  listHistorySince(timestamp: number): Promise<ActivityEvent[]>;
}

export interface AndroidRuntimeRefresh {
  (): Promise<void>;
  dispose(): void;
}

export function createAndroidRuntimeRepository(
  host: Pick<AndroidHost, 'loadRuntimeSnapshot'>,
): AndroidRuntimeRepository {
  let cached: Promise<AndroidRuntimeState | null> | undefined;
  let minimumRevision = -1;

  const load = (): Promise<AndroidRuntimeState | null> => {
    if (cached !== undefined) return cached;
    const request = host.loadRuntimeSnapshot().then((state) => {
      if (state !== null && state.revision < minimumRevision) {
        throw new Error('stale Android runtime snapshot');
      }
      return state;
    }).catch((error: unknown) => {
      if (cached === request) cached = undefined;
      throw error;
    });
    cached = request;
    return request;
  };

  return {
    load,

    invalidate(revision?: number): boolean {
      if (revision !== undefined) {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision <= minimumRevision) {
          return false;
        }
        minimumRevision = revision;
      }
      cached = undefined;
      return true;
    },

    async listHistorySince(timestamp: number): Promise<ActivityEvent[]> {
      const state = await load();
      return state === null
        ? []
        : state.history.filter((event) => event.occurredAt >= timestamp);
    },
  };
}

export function createOrderedAndroidRuntimeRefresh(
  load: () => Promise<AndroidRuntimeState | null>,
  apply: (state: AndroidRuntimeState) => void,
): AndroidRuntimeRefresh {
  let latestAppliedRevision = -1;
  let retryPending = false;
  let disposed = false;

  const run = async (allowRetry: boolean): Promise<void> => {
    try {
      const state = await load();
      if (disposed || state === null || state.revision <= latestAppliedRevision) return;
      latestAppliedRevision = state.revision;
      apply(state);
    } catch {
      if (disposed || !allowRetry || retryPending) return;
      retryPending = true;
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      if (disposed) {
        retryPending = false;
        return;
      }
      try {
        await run(false);
      } finally {
        retryPending = false;
      }
    }
  };

  return Object.assign(
    () => run(true),
    { dispose: () => { disposed = true; } },
  );
}
