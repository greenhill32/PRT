// IndexedDB queue for offline event persistence and sync
import type { QueuedEvent } from './types';

const DB_NAME = 'prt-offline';
const QUEUE_STORE = 'queued-events';
const BASELINE_STORE = 'baseline-cache';
const COMPETITOR_STORE = 'competitor-cache';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object stores
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'event_id' });
      }

      if (!database.objectStoreNames.contains(BASELINE_STORE)) {
        database.createObjectStore(BASELINE_STORE, { keyPath: 'session_id' });
      }

      if (!database.objectStoreNames.contains(COMPETITOR_STORE)) {
        database.createObjectStore(COMPETITOR_STORE, { keyPath: 'session_id' });
      }
    };
  });
}

export async function getDB(): Promise<IDBDatabase> {
  if (!db) {
    db = await initDB();
  }
  return db;
}

// Queue operations
export async function queueEvent(event: QueuedEvent): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.put(event);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getQueuedEvents(): Promise<QueuedEvent[]> {
  const database = await getDB();
  const tx = database.transaction(QUEUE_STORE, 'readonly');
  const store = tx.objectStore(QUEUE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getQueuedEventsBySession(session_id: string): Promise<QueuedEvent[]> {
  const allQueued = await getQueuedEvents();
  return allQueued.filter((e) => e.session_id === session_id);
}

export async function getQueuedEventsByStatus(status: string): Promise<QueuedEvent[]> {
  const allQueued = await getQueuedEvents();
  return allQueued.filter((e) => e.status === status);
}

export async function updateQueuedEventStatus(
  event_id: string,
  status: 'queued' | 'syncing' | 'synced' | 'error',
  error?: string
): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);

  const event = await new Promise<QueuedEvent | undefined>((resolve, reject) => {
    const request = store.get(event_id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  if (event) {
    event.status = status;
    if (error) event.error = error;

    return new Promise((resolve, reject) => {
      const request = store.put(event);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export async function removeQueuedEvent(event_id: string): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.delete(event_id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clearQueue(): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(QUEUE_STORE, 'readwrite');
  const store = tx.objectStore(QUEUE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getQueuedCount(): Promise<number> {
  const queued = await getQueuedEvents();
  return queued.filter((e) => e.status === 'queued').length;
}

// Baseline cache
export async function cacheBaseline(session_id: string, baseline: any): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(BASELINE_STORE, 'readwrite');
  const store = tx.objectStore(BASELINE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.put({ session_id, baseline, cached_at: Date.now() });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getCachedBaseline(session_id: string): Promise<any | null> {
  const database = await getDB();
  const tx = database.transaction(BASELINE_STORE, 'readonly');
  const store = tx.objectStore(BASELINE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.get(session_id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.baseline : null);
    };
  });
}

export async function getLastCachedBaseline(): Promise<any | null> {
  const database = await getDB();
  const tx = database.transaction(BASELINE_STORE, 'readonly');
  const store = tx.objectStore(BASELINE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const results = request.result;
      if (results.length === 0) {
        resolve(null);
      } else {
        const latest = results.sort(
          (a, b) => b.cached_at - a.cached_at
        )[0];
        resolve(latest.baseline);
      }
    };
  });
}

// Competitor cache
export async function cacheCompetitors(session_id: string, competitors: any): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(COMPETITOR_STORE, 'readwrite');
  const store = tx.objectStore(COMPETITOR_STORE);

  return new Promise((resolve, reject) => {
    const request = store.put({ session_id, competitors, cached_at: Date.now() });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getCachedCompetitors(session_id: string): Promise<any | null> {
  const database = await getDB();
  const tx = database.transaction(COMPETITOR_STORE, 'readonly');
  const store = tx.objectStore(COMPETITOR_STORE);

  return new Promise((resolve, reject) => {
    const request = store.get(session_id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.competitors : null);
    };
  });
}
