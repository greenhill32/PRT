// Durable IndexedDB writes resolve when the transaction commits, not just the request.
import type { QueuedEvent, Session, Event } from './types';

const DB_NAME = 'prt-offline';
const QUEUE_STORE = 'queued-events';
const BASELINE_STORE = 'baseline-cache';
const COMPETITOR_STORE = 'competitor-cache';
const SESSION_STORE = 'session-cache';
const EVENT_STORE = 'event-cache';
const PROGRESS_STORE = 'progress-cache';
const DB_VERSION = 3;
let db: IDBDatabase | null = null;
let opening: Promise<IDBDatabase> | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => { opening = null; reject(request.error); };
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => { db?.close(); db = null; opening = null; };
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [QUEUE_STORE, BASELINE_STORE, COMPETITOR_STORE, SESSION_STORE, EVENT_STORE, PROGRESS_STORE]) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: name === QUEUE_STORE ? 'event_id' : name === PROGRESS_STORE ? 'user_id' : 'session_id' });
        }
      }
    };
  });
  return opening;
}

export const getDB = initDB;

async function request<T>(name: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(name, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    const req = action(tx.objectStore(name));
    req.onsuccess = () => { value = req.result; };
    req.onerror = () => reject(req.error);
  });
}

export const queueEvent = (event: QueuedEvent): Promise<void> =>
  request(QUEUE_STORE, 'readwrite', store => store.put(event));

export const getQueuedEvents = (): Promise<QueuedEvent[]> =>
  request(QUEUE_STORE, 'readonly', store => store.getAll());

export async function getQueuedEventsBySession(session_id: string): Promise<QueuedEvent[]> {
  return (await getQueuedEvents()).filter(e => e.session_id === session_id);
}

export async function getQueuedEventsByStatus(status: string): Promise<QueuedEvent[]> {
  return (await getQueuedEvents()).filter(e => e.status === status);
}

export async function updateQueuedEventStatus(
  event_id: string, status: QueuedEvent['status'], error?: string
): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(QUEUE_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.get(event_id);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, status, error });
    };
  });
}

export const removeQueuedEvent = (event_id: string): Promise<void> =>
  request(QUEUE_STORE, 'readwrite', store => store.delete(event_id));

export const clearQueue = (): Promise<void> =>
  request(QUEUE_STORE, 'readwrite', store => store.clear());

export async function getQueuedCount(session_id?: string): Promise<number> {
  return (await getQueuedEvents()).filter(e =>
    e.status !== 'synced' && (!session_id || e.session_id === session_id)
  ).length;
}

const cachePut = (name: string, session_id: string, data: unknown): Promise<void> =>
  request(name, 'readwrite', store => store.put({ session_id, data, cached_at: Date.now() }));

async function cacheGet<T>(name: string, session_id: string): Promise<T | null> {
  const row = await request<any>(name, 'readonly', store => store.get(session_id));
  // Read the v1 baseline/competitor cache shape as well as v2.
  return row ? row.data ?? row.baseline ?? row.competitors ?? null : null;
}

export const cacheBaseline = (id: string, value: unknown) => cachePut(BASELINE_STORE, id, value);
export const getCachedBaseline = (id: string) => cacheGet<any>(BASELINE_STORE, id);
export async function getLastCachedBaseline(): Promise<any | null> {
  const rows = await request<any[]>(BASELINE_STORE, 'readonly', store => store.getAll());
  const row = rows.sort((a, b) => b.cached_at - a.cached_at)[0];
  return row ? row.data ?? row.baseline : null;
}
export const cacheCompetitors = (id: string, value: unknown) => cachePut(COMPETITOR_STORE, id, value);
export const getCachedCompetitors = (id: string) => cacheGet<any>(COMPETITOR_STORE, id);
export const cacheSession = (session: Session) => cachePut(SESSION_STORE, session.session_id, session);
export const getCachedSession = (id: string) => cacheGet<Session>(SESSION_STORE, id);
export async function getCachedSessions(user_id: string): Promise<Session[]> {
  const rows = await request<any[]>(SESSION_STORE, 'readonly', store => store.getAll());
  return rows.map(r => r.data as Session).filter(s => s.user_id === user_id);
}
export async function cacheSessionEvents(id: string, events: Event[]): Promise<void> {
  // The ledger is append-only. Merge in one transaction so a stale GET cannot
  // overwrite an event just cached by the uploader before an offline reload.
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(EVENT_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    const store = tx.objectStore(EVENT_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const existing: Event[] = req.result?.data ?? [];
      const merged = new Map(existing.map(event => [event.event_id, event]));
      for (const event of events) if (event.session_id === id) merged.set(event.event_id, event);
      store.put({ session_id: id, data: [...merged.values()], cached_at: Date.now() });
    };
  });
}
export async function getCachedSessionEvents(id: string): Promise<Event[]> {
  return await cacheGet<Event[]>(EVENT_STORE, id) ?? [];
}
export async function cacheSyncedEvent(event: Event): Promise<void> {
  await cacheSessionEvents(event.session_id, [event]);
}

export interface CachedProgressHistory { sessions: Session[]; events: Event[]; fetchedAt: string }
export const cacheProgressHistory = (user_id: string, data: CachedProgressHistory): Promise<void> =>
  request(PROGRESS_STORE, 'readwrite', store => store.put({ user_id, data }));
export async function getCachedProgressHistory(user_id: string): Promise<CachedProgressHistory | null> {
  const row = await request<{ data: CachedProgressHistory } | undefined>(PROGRESS_STORE, 'readonly', store => store.get(user_id));
  return row?.data ?? null;
}
