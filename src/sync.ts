// Background sync for queued events
import * as queue from './queue';
import * as supabase from './supabase';
import type { Event } from './types';

let syncInProgress = false;
let syncInterval: number | null = null;

// Exponential backoff for retries
function getBackoffDelay(attempts: number): number {
  return Math.min(30000, 1000 * Math.pow(2, attempts));
}

export async function syncQueue(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  if (syncInProgress) {
    return { synced: 0, failed: 0, errors: ['Sync already in progress'] };
  }

  syncInProgress = true;
  const results = { synced: 0, failed: 0, errors: [] as string[] };

  try {
    // Sync both queued and errored items (retry failed events)
    const queued = await queue.getQueuedEventsByStatus('queued');
    const errored = await queue.getQueuedEventsByStatus('error');
    const allToSync = [...queued, ...errored];

    for (const queuedEvent of allToSync) {
      await queue.updateQueuedEventStatus(queuedEvent.event_id, 'syncing');

      try {
        // Convert queued event to database Event format
        const dbEvent: Omit<Event, 'created_at'> = {
          event_id: queuedEvent.event_id,
          session_id: queuedEvent.session_id,
          event_type: queuedEvent.event_type,
          raw_value: queuedEvent.raw_value,
          unit: queuedEvent.unit,
          timestamp: queuedEvent.timestamp,
          source: 'app',
          correction_of: null,
          voids_event_id: null,
          detail: queuedEvent.detail
        };

        // Append to Supabase
        await supabase.appendEvent(dbEvent);

        // Remove from queue (successfully synced)
        await queue.removeQueuedEvent(queuedEvent.event_id);
        results.synced++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if it's a duplicate (already exists - idempotent)
        if (errorMsg.includes('duplicate') || errorMsg.includes('unique')) {
          await queue.removeQueuedEvent(queuedEvent.event_id);
          results.synced++;
        } else {
          // Keep in error state for future retry
          await queue.updateQueuedEventStatus(
            queuedEvent.event_id,
            'error',
            errorMsg
          );
          results.failed++;
          results.errors.push(`${queuedEvent.event_id}: ${errorMsg}`);
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.errors.push(`Sync failed: ${errorMsg}`);
  } finally {
    syncInProgress = false;
  }

  return results;
}

// Start periodic sync (e.g., every 30 seconds when online)
export function startPeriodicSync(interval: number = 30000): void {
  if (syncInterval) return; // Already running

  const id = setInterval(async () => {
    if (navigator.onLine) {
      try {
        await syncQueue();
      } catch (error) {
        console.error('Periodic sync error:', error);
      }
    }
  }, interval) as unknown as number;

  syncInterval = id;
}

// Stop periodic sync
export function stopPeriodicSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval as unknown as number);
    syncInterval = null;
  }
}

// Manual sync trigger
export async function triggerSync(): Promise<void> {
  if (!navigator.onLine) {
    throw new Error('Device is offline');
  }
  await syncQueue();
}

// Listen for online/offline events
export function setupSyncListeners(): void {
  window.addEventListener('online', async () => {
    console.log('Device online, starting sync...');
    await syncQueue();
  });

  window.addEventListener('offline', () => {
    console.log('Device offline');
  });
}

// Watch for network changes and trigger sync
export function setupNetworkWatcher(onQueuedCountChange: (count: number) => void): void {
  setupSyncListeners();
  startPeriodicSync();

  // Initial check
  setInterval(async () => {
    const count = await queue.getQueuedCount();
    onQueuedCountChange(count);
  }, 1000);
}

// Cleanup
export function cleanupSync(): void {
  stopPeriodicSync();
}
