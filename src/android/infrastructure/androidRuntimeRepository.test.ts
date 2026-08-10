import { expect, test } from 'vitest';
import { createDefaultSettings } from '../../app/defaults';
import type { AndroidRuntimeState } from '../domain/runtimeSnapshot';
import {
  createAndroidRuntimeRepository,
  createOrderedAndroidRuntimeRefresh,
} from './androidRuntimeRepository';

function runtimeState(revision: number, occurredAt = 100): AndroidRuntimeState {
  return {
    revision,
    settings: createDefaultSettings(revision, 'en'),
    history: [{ id: `event-${revision}`, action: 'completed', occurredAt }],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('runtime repository caches only the compact load and refreshes history after invalidation', async () => {
  let runtimeLoads = 0;
  let current = runtimeState(1, 50);
  const host = {
    async loadRuntimeSnapshot(): Promise<AndroidRuntimeState> {
      runtimeLoads += 1;
      return current;
    },
    async loadSnapshot(): Promise<never> {
      throw new Error('full snapshot must not load on a runtime refresh');
    },
  };
  const repository = createAndroidRuntimeRepository(host);

  await Promise.all([repository.load(), repository.load()]);
  expect(runtimeLoads).toBe(1);

  current = runtimeState(2, 250);
  expect(repository.invalidate(2)).toBe(true);
  await expect(repository.listHistorySince(200)).resolves.toEqual(current.history);
  expect(runtimeLoads).toBe(2);

  expect(repository.invalidate(1)).toBe(false);
  await repository.load();
  expect(runtimeLoads).toBe(2);
});

test('ordered runtime refresh rejects a late stale response', async () => {
  const first = deferred<AndroidRuntimeState>();
  const second = deferred<AndroidRuntimeState>();
  const loads = [first, second];
  const applied: number[] = [];
  const refresh = createOrderedAndroidRuntimeRefresh(
    () => loads.shift()!.promise,
    (state) => applied.push(state.revision),
  );

  refresh();
  refresh();
  second.resolve(runtimeState(2));
  await flushPromises();
  first.resolve(runtimeState(1));
  await flushPromises();

  expect(applied).toEqual([2]);
});

test('failed runtime refresh keeps current state and schedules one retry', async () => {
  let calls = 0;
  const applied: number[] = [];
  const refresh = createOrderedAndroidRuntimeRefresh(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient native read failure');
      return runtimeState(3);
    },
    (state) => applied.push(state.revision),
  );

  refresh();
  await flushPromises();
  await flushPromises();

  expect(calls).toBe(2);
  expect(applied).toEqual([3]);
});
