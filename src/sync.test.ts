import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import * as queue from './queue';
import * as api from './supabase';
import { syncQueue, completeSession, setupNetworkWatcher, cleanupSync } from './sync';
import type { QueuedEvent } from './types';

vi.mock('./supabase', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'owner' })),
  getSession: vi.fn(async () => ({ user_id: 'owner' })),
  appendEvent: vi.fn(),
  updateSessionState: vi.fn(),
  supabase: { from: vi.fn() }
}));
const item = (id = 'event'): QueuedEvent => ({
  event_id: id, session_id: 'session', user_id: 'owner', event_type: 'pushups',
  raw_value: 38, unit: 'reps', timestamp: '2026-10-29T12:00:00Z', source: 'app', detail: null, status: 'queued'
});
beforeEach(async () => {
  await queue.clearQueue();
  vi.mocked(api.appendEvent).mockReset().mockResolvedValue({} as any);
  vi.mocked(api.updateSessionState).mockReset();
  vi.stubGlobal('navigator', { onLine: true });
});
afterAll(() => { cleanupSync(); vi.unstubAllGlobals(); });

describe('Durable queue and completion', () => {
  it('keeps failed and interrupted uploads visible and retries them', async () => {
    await queue.queueEvent(item());
    vi.mocked(api.appendEvent).mockRejectedValueOnce({ message: 'Network unavailable' });
    expect((await syncQueue()).failed).toBe(1);
    expect(await queue.getQueuedCount('session')).toBe(1);
    expect((await syncQueue()).synced).toBe(1);
    await queue.queueEvent({ ...item('interrupted'), status: 'syncing' });
    expect((await syncQueue()).synced).toBe(1);
    expect(await queue.getQueuedCount('session')).toBe(0);
  });
  it('awaits an existing sync instead of reporting an empty success', async () => {
    await queue.queueEvent(item());
    const first = syncQueue(), second = syncQueue();
    expect(second).toBe(first);
    expect((await second).synced).toBe(1);
    expect(api.appendEvent).toHaveBeenCalledTimes(1);
  });
  it('does not complete a session after any upload fails', async () => {
    await queue.queueEvent(item());
    vi.mocked(api.appendEvent).mockRejectedValueOnce({ message: 'offline' });
    await expect(completeSession('session')).rejects.toThrow('still need to sync');
    expect(api.updateSessionState).not.toHaveBeenCalled();
  });
  it('does not count another session\'s pending uploads against completion', async () => {
    await queue.queueEvent({ ...item(), session_id: 'other-session' });
    vi.mocked(api.appendEvent).mockRejectedValueOnce(new Error('offline'));
    const events = ['pushups', 'plank', 'row_2k'].map((type, i) => ({
      ...item(type), event_type: type, raw_value: [38, 122, 530][i], created_at: item().timestamp
    }));
    vi.mocked(api.supabase.from).mockReturnValue({ select: () => ({ eq: async () => ({ data: events, error: null }) }) } as any);
    await completeSession('session');
    expect(api.updateSessionState).toHaveBeenCalledWith('session', 'completed');
  });
  it('uploads correction dependencies before void/replacement rows', async () => {
    await queue.queueEvent(item('z-original'));
    await queue.queueEvent({ ...item('a-void'), event_type: 'void', raw_value: null, voids_event_id: 'z-original' });
    await syncQueue();
    expect(vi.mocked(api.appendEvent).mock.calls.map(([e]) => e.event_id)).toEqual(['z-original', 'a-void']);
  });
  it('does not let a stale server read erase a cached uploaded event', async () => {
    const event = { ...item('cached'), created_at: item().timestamp, correction_of: null, voids_event_id: null };
    await queue.cacheSyncedEvent(event);
    await queue.cacheSessionEvents('session', []);
    expect((await queue.getCachedSessionEvents('session')).some(e => e.event_id === 'cached')).toBe(true);
  });
  it('leaves another account\'s queue untouched', async () => {
    await queue.queueEvent({ ...item(), user_id: 'someone-else' });
    await syncQueue();
    expect(api.appendEvent).not.toHaveBeenCalled();
    expect(await queue.getQueuedCount()).toBe(1);
  });
});
