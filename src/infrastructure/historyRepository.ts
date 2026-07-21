import type { ActivityEvent } from '../app/model';

export interface HistoryRepository {
  append(value: ActivityEvent): Promise<void>;
  listSince(timestamp: number): Promise<ActivityEvent[]>;
  prune(now: number): Promise<void>;
  clear(): Promise<void>;
}

export const HISTORY_DB = 'neko-pause';
export const HISTORY_STORE = 'activity';
export type CreateHistoryRepository = (factory: IDBFactory, databaseName?: string) => HistoryRepository;

const RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1000;

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        const store = database.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
        store.createIndex('occurredAt', 'occurredAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open activity history'));
    request.onblocked = () => reject(new Error('Activity history database is blocked'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Activity history transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Activity history transaction aborted'));
  });
}

export const createIndexedDbHistoryRepository: CreateHistoryRepository = (
  factory,
  databaseName = HISTORY_DB,
) => {
  const database = openDatabase(factory, databaseName);

  return {
    async append(value): Promise<void> {
      const transaction = (await database).transaction(HISTORY_STORE, 'readwrite');
      transaction.objectStore(HISTORY_STORE).put(value);
      await waitForTransaction(transaction);
    },

    async listSince(timestamp): Promise<ActivityEvent[]> {
      const transaction = (await database).transaction(HISTORY_STORE, 'readonly');
      const request = transaction
        .objectStore(HISTORY_STORE)
        .index('occurredAt')
        .getAll(IDBKeyRange.lowerBound(timestamp));
      const result = await new Promise<ActivityEvent[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as ActivityEvent[]);
        request.onerror = () => reject(request.error ?? new Error('Could not read activity history'));
      });
      await waitForTransaction(transaction);
      return result;
    },

    async prune(now): Promise<void> {
      const transaction = (await database).transaction(HISTORY_STORE, 'readwrite');
      const request = transaction
        .objectStore(HISTORY_STORE)
        .index('occurredAt')
        .openKeyCursor(IDBKeyRange.upperBound(now - RETENTION_MILLISECONDS, true));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          transaction.objectStore(HISTORY_STORE).delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      await waitForTransaction(transaction);
    },

    async clear(): Promise<void> {
      const transaction = (await database).transaction(HISTORY_STORE, 'readwrite');
      transaction.objectStore(HISTORY_STORE).clear();
      await waitForTransaction(transaction);
    },
  };
};
