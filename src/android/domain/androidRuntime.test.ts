import { expect, test, vi } from 'vitest';
import {
  androidAppProviderLifecycle,
  connectAndroidRuntimeEvents,
  createCoalescedAndroidRuntimeSignalRefresh,
} from './androidRuntime';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidRuntimeState } from './runtimeSnapshot';

test('Android app leaves reminder scheduling authority with the native service', () => {
  expect(androidAppProviderLifecycle).toBe('passive');
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function runtimeState(revision: number): AndroidRuntimeState {
  return { revision, settings: createDefaultSettings(revision, 'en'), history: [] };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('Android runtime event bursts allow one active load and one highest-revision trailing load', async () => {
  const invalidated: number[] = [];
  const first = deferred<void>();
  const second = deferred<void>();
  const pending = [first, second];
  let active = 0;
  let maximumActive = 0;
  let refreshes = 0;
  const refresh = createCoalescedAndroidRuntimeSignalRefresh(
    (revision) => {
      invalidated.push(revision);
      return true;
    },
    async () => {
      refreshes += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await pending.shift()!.promise;
      active -= 1;
    },
  );

  refresh.signal(3);
  await flushPromises();
  expect(refreshes).toBe(1);

  refresh.signal(5);
  await Promise.resolve();
  refresh.signal(4);
  await flushPromises();
  expect(refreshes).toBe(1);

  first.resolve();
  await flushPromises();
  expect(refreshes).toBe(2);
  second.resolve();
  await flushPromises();

  expect(invalidated).toEqual([3, 5]);
  expect(maximumActive).toBe(1);
  refresh.dispose();
});

test('a failed active load keeps its retry ahead of one bounded trailing refresh', async () => {
  let listener: ((event: { type: 'stateChanged' } | {
    type: 'runtimeStateChanged'; revision: number;
  }) => void) | undefined;
  const first = deferred<AndroidRuntimeState>();
  const retry = deferred<AndroidRuntimeState>();
  const trailing = deferred<AndroidRuntimeState>();
  const pending = [first, retry, trailing];
  let loads = 0;
  let active = 0;
  let maximumActive = 0;
  const disconnect = connectAndroidRuntimeEvents({
    subscribe(next) {
      listener = next;
      return () => undefined;
    },
    invalidateLegacy: () => undefined,
    invalidateRuntime: () => true,
    load: () => {
      loads += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return pending.shift()!.promise.finally(() => { active -= 1; });
    },
    apply: () => undefined,
  });

  listener?.({ type: 'runtimeStateChanged', revision: 1 });
  await flushPromises();
  listener?.({ type: 'runtimeStateChanged', revision: 2 });
  first.reject(new Error('transient native read failure'));
  await flushPromises();
  await flushPromises();

  expect(loads).toBe(2);
  expect(maximumActive).toBe(1);

  retry.resolve(runtimeState(1));
  await vi.waitFor(() => expect(loads).toBe(3));
  expect(maximumActive).toBe(1);

  trailing.resolve(runtimeState(2));
  await flushPromises();
  disconnect();
});

test('disconnecting runtime events cancels queued work and removes the native listener', async () => {
  let listener: ((event: { type: 'stateChanged' } | {
    type: 'runtimeStateChanged'; revision: number;
  }) => void) | undefined;
  let removed = false;
  let loads = 0;
  const disconnect = connectAndroidRuntimeEvents({
    subscribe(next) {
      listener = next;
      return () => { removed = true; };
    },
    invalidateLegacy: () => undefined,
    invalidateRuntime: () => true,
    load: async () => { loads += 1; return runtimeState(1); },
    apply: () => undefined,
  });

  listener?.({ type: 'runtimeStateChanged', revision: 1 });
  disconnect();
  await flushPromises();

  expect(removed).toBe(true);
  expect(loads).toBe(0);
});

test('disconnecting runtime events prevents an in-flight response from applying', async () => {
  let listener: ((event: { type: 'stateChanged' } | {
    type: 'runtimeStateChanged'; revision: number;
  }) => void) | undefined;
  const loaded = deferred<AndroidRuntimeState>();
  const applied: number[] = [];
  const disconnect = connectAndroidRuntimeEvents({
    subscribe(next) {
      listener = next;
      return () => undefined;
    },
    invalidateLegacy: () => undefined,
    invalidateRuntime: () => true,
    load: () => loaded.promise,
    apply: (state) => applied.push(state.revision),
  });

  listener?.({ type: 'runtimeStateChanged', revision: 2 });
  await flushPromises();
  disconnect();
  loaded.resolve(runtimeState(2));
  await flushPromises();

  expect(applied).toEqual([]);
});
