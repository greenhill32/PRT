import * as queue from './queue';
import * as api from './supabase';
import { queuedToEvent, nextMissingEvent } from './sessionState';
import { errorMessage } from './eventPersistence';
import type { QueuedEvent } from './types';

interface SyncResult { synced: number; failed: number; errors: string[] }
let running: Promise<SyncResult> | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let countInterval: ReturnType<typeof setInterval> | null = null;
let removeListeners: (() => void) | null = null;

// Old syncing rows represent uploads interrupted by a reload/crash. Retrying their UUID is safe.
function orderForSync(events: QueuedEvent[]): QueuedEvent[] {
  const remaining = new Map(events.map(e => [e.event_id, e]));
  const ordered: QueuedEvent[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter(e =>
      !remaining.has(e.correction_of ?? '') && !remaining.has(e.voids_event_id ?? '')
    ).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_id.localeCompare(b.event_id));
    if (!ready.length) throw new Error('Invalid circular correction references in local queue.');
    for (const event of ready) { ordered.push(event); remaining.delete(event.event_id); }
  }
  return ordered;
}

async function runSync(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };
  try {
    const user = await api.getCurrentUser();
    if (!user) throw new Error('Sign in before syncing results.');
    const pending = (await queue.getQueuedEvents()).filter(e => e.status !== 'synced' && (!e.user_id || e.user_id === user.id));
    for (const item of orderForSync(pending)) {
      try {
        // Protect legacy queue rows that predate local user_id tagging.
        if (!item.user_id && (await api.getSession(item.session_id)).user_id !== user.id) continue;
        await queue.updateQueuedEventStatus(item.event_id, 'syncing');
        const { created_at: _created, ...event } = queuedToEvent(item);
        await api.appendEvent(event);
        await queue.removeQueuedEvent(item.event_id);
        result.synced++;
      } catch (error) {
        const message = errorMessage(error);
        await queue.updateQueuedEventStatus(item.event_id, 'error', message);
        result.failed++;
        result.errors.push(item.event_id + ': ' + message);
      }
    }
  } catch (error) { result.errors.push(errorMessage(error)); }
  return result;
}

export function syncQueue(): Promise<SyncResult> {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

export async function completeSession(sessionId: string): Promise<void> {
  if (!navigator.onLine) throw new Error('Results are stored on this device. Reconnect before completing the session.');
  await syncQueue();
  const pending = await queue.getQueuedCount(sessionId);
  if (pending) throw new Error(pending + ' result(s) still need to sync. Session remains in progress.');
  // Read persisted rows after syncing; cached/optimistic React state cannot prove completion.
  const { data, error } = await api.supabase.from('events').select().eq('session_id', sessionId);
  if (error) throw error;
  if (nextMissingEvent(data || [])) throw new Error('All three results must be saved before completing the session.');
  await api.updateSessionState(sessionId, 'completed');
}

export function startPeriodicSync(interval = 30000): void {
  if (!syncInterval) syncInterval = setInterval(() => {
    if (navigator.onLine) void syncQueue();
  }, interval);
}
export function stopPeriodicSync(): void {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
}
export async function triggerSync(): Promise<void> {
  if (!navigator.onLine) throw new Error('Device is offline');
  await syncQueue();
}
export function setupSyncListeners(): void {
  if (removeListeners) return;
  const online = () => { void syncQueue(); };
  window.addEventListener('online', online);
  removeListeners = () => window.removeEventListener('online', online);
}
export function setupNetworkWatcher(onQueuedCountChange: (count: number) => void): void {
  cleanupSync();
  setupSyncListeners();
  startPeriodicSync();
  const update = () => { void queue.getQueuedCount().then(onQueuedCountChange).catch(console.error); };
  countInterval = setInterval(update, 1000);
  update();
  if (navigator.onLine) void syncQueue();
}
export function cleanupSync(): void {
  stopPeriodicSync();
  if (countInterval) clearInterval(countInterval);
  countInterval = null;
  removeListeners?.();
  removeListeners = null;
}
