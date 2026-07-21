import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test } from 'vitest';

import { createIndexedDbHistoryRepository } from './historyRepository';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 11);

type EventHandler = ((event: Event) => void) | null;

interface ControlledOpenRequest {
  error: Error | null;
  result: IDBDatabase;
  onblocked: EventHandler;
  onerror: EventHandler;
  onsuccess: EventHandler;
  onupgradeneeded: EventHandler;
}

interface ControlledTransaction {
  error: Error | null;
  onabort: EventHandler;
  oncomplete: EventHandler;
  onerror: EventHandler;
  objectStore: () => unknown;
}

function createControlledFactory(database: IDBDatabase | null, openError: Error | null = null): IDBFactory {
  return {
    open: () => {
      const request: ControlledOpenRequest = {
        error: openError,
        result: database as IDBDatabase,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (openError) request.onerror?.(new Event('error'));
        else request.onsuccess?.(new Event('success'));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

function createControlledDatabase(createTransaction: () => ControlledTransaction): IDBDatabase {
  return {
    transaction: () => createTransaction() as unknown as IDBTransaction,
  } as unknown as IDBDatabase;
}

async function captureRejectionWithin(promise: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('repository promise timed out')), 100);
  });
  try {
    await Promise.race([promise, timeout]);
    throw new Error('repository promise unexpectedly resolved');
  } catch (error) {
    return error;
  } finally {
    clearTimeout(timer);
  }
}

describe('IndexedDB history repository', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
  });

  test('history prunes events older than 90 days', async () => {
    const repo = createIndexedDbHistoryRepository(factory, 'history-prune-test');
    await repo.append({ id: 'old', reminderType: 'drinkWater', action: 'completed', occurredAt: NOW - 91 * DAY });
    await repo.append({ id: 'boundary', reminderType: 'lookAway', action: 'snoozed', occurredAt: NOW - 90 * DAY });
    await repo.append({ id: 'new', reminderType: 'standUp', action: 'skipped', occurredAt: NOW });

    await repo.prune(NOW);

    expect(await repo.listSince(NOW - 100 * DAY)).toEqual([
      expect.objectContaining({ id: 'boundary' }),
      expect.objectContaining({ id: 'new' }),
    ]);
  });

  test('lists events inclusively in occurred-at order', async () => {
    const repo = createIndexedDbHistoryRepository(factory, 'history-list-test');
    await repo.append({ id: 'later', reminderType: 'takeBreak', action: 'completed', occurredAt: NOW + 1 });
    await repo.append({ id: 'earlier', reminderType: 'drinkWater', action: 'skipped', occurredAt: NOW });
    await repo.append({ id: 'before', reminderType: 'lookAway', action: 'snoozed', occurredAt: NOW - 1 });

    await expect(repo.listSince(NOW)).resolves.toEqual([
      { id: 'earlier', reminderType: 'drinkWater', action: 'skipped', occurredAt: NOW },
      { id: 'later', reminderType: 'takeBreak', action: 'completed', occurredAt: NOW + 1 },
    ]);
  });

  test('replaces an event with the same id', async () => {
    const repo = createIndexedDbHistoryRepository(factory, 'history-key-test');
    await repo.append({ id: 'same', reminderType: 'lookAway', action: 'skipped', occurredAt: NOW });
    await repo.append({ id: 'same', reminderType: 'standUp', action: 'completed', occurredAt: NOW + 1 });

    await expect(repo.listSince(0)).resolves.toEqual([
      { id: 'same', reminderType: 'standUp', action: 'completed', occurredAt: NOW + 1 },
    ]);
  });

  test('clear removes all history and leaves the repository usable', async () => {
    const repo = createIndexedDbHistoryRepository(factory, 'history-clear-test');
    await repo.append({ id: 'one', reminderType: 'lookAway', action: 'completed', occurredAt: NOW });

    await repo.clear();

    await expect(repo.listSince(0)).resolves.toEqual([]);
    await repo.append({ id: 'two', reminderType: 'takeBreak', action: 'skipped', occurredAt: NOW });
    await expect(repo.listSince(0)).resolves.toEqual([expect.objectContaining({ id: 'two' })]);
  });

  test('open failure rejects promptly with the underlying error', async () => {
    const failure = new Error('open failed');
    const repo = createIndexedDbHistoryRepository(createControlledFactory(null, failure));

    expect(await captureRejectionWithin(repo.listSince(0))).toBe(failure);
  });

  test('transaction creation failure rejects promptly with the underlying error', async () => {
    const failure = new Error('transaction failed');
    const database = {
      transaction: () => { throw failure; },
    } as unknown as IDBDatabase;
    const repo = createIndexedDbHistoryRepository(createControlledFactory(database));

    expect(await captureRejectionWithin(repo.clear())).toBe(failure);
  });

  test('request failure rejects promptly with the underlying error', async () => {
    const failure = new Error('request failed');
    const database = createControlledDatabase(() => {
      const request: { error: Error; onerror: EventHandler; onsuccess: EventHandler } = {
        error: failure,
        onerror: null,
        onsuccess: null,
      };
      const transaction: ControlledTransaction = {
        error: null,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => ({
          index: () => ({
            getAll: () => {
              queueMicrotask(() => request.onerror?.(new Event('error')));
              return request;
            },
          }),
        }),
      };
      return transaction;
    });
    const repo = createIndexedDbHistoryRepository(createControlledFactory(database));

    expect(await captureRejectionWithin(repo.listSince(0))).toBe(failure);
  });

  test('transaction abort rejects promptly with the underlying error', async () => {
    const failure = new Error('transaction aborted');
    const database = createControlledDatabase(() => {
      const transaction: ControlledTransaction = {
        error: failure,
        onabort: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => ({
          put: () => queueMicrotask(() => transaction.onabort?.(new Event('abort'))),
        }),
      };
      return transaction;
    });
    const repo = createIndexedDbHistoryRepository(createControlledFactory(database));

    expect(await captureRejectionWithin(repo.append({
      id: 'event', reminderType: 'lookAway', action: 'completed', occurredAt: NOW,
    }))).toBe(failure);
  });
});
