import 'fake-indexeddb/auto';
import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

// In-memory stand-in for the Supabase tables. Duplicate primary keys fail with 23505, as in Postgres.
const USER = 'owner';
const remote = { sessions: new Map<string, any>(), events: new Map<string, any>() };
let failNextSessionInsert: unknown = null;

function table(name: 'sessions' | 'events') {
  const rows = remote[name];
  const key = name === 'sessions' ? 'session_id' : 'event_id';
  return {
    insert(values: any[]) {
      return {
        select: () => ({
          single: async () => {
            if (name === 'sessions' && failNextSessionInsert) {
              const error = failNextSessionInsert;
              failNextSessionInsert = null;
              throw error;
            }
            const row = values[0];
            if (rows.has(row[key])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            rows.set(row[key], row);
            return { data: row, error: null };
          }
        })
      };
    },
    select: () => ({
      eq: (column: string, value: string) => ({
        maybeSingle: async () => ({ data: [...rows.values()].find(r => r[column] === value) ?? null, error: null })
      })
    })
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: USER } } } }) },
    from: (name: 'sessions' | 'events') => table(name)
  })
}));

import * as queue from './queue';
import { createSession } from './supabase';
import { syncQueue, completeSession, cleanupSync } from './sync';

const sessionArgs = ['saturday_prt', 1234, null, {}] as const;

beforeEach(async () => {
  remote.sessions.clear();
  remote.events.clear();
  failNextSessionInsert = null;
  await queue.clearQueue();
  for (const s of await queue.getPendingSessions()) await queue.removePendingSession(s.session_id);
  vi.stubGlobal('navigator', { onLine: true });
});
afterAll(() => { cleanupSync(); vi.unstubAllGlobals(); });

describe('sessions started offline', () => {
  it('saves a session locally when the device is offline, without contacting Supabase', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const session = await createSession(...sessionArgs);
    expect(session.state).toBe('in_progress');
    expect(remote.sessions.size).toBe(0);
    expect((await queue.getPendingSessions()).map(s => s.session_id)).toEqual([session.session_id]);
  });

  it('uploads the session before its results, then clears the local copy', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const session = await createSession(...sessionArgs);
    await queue.queueEvent({
      event_id: 'e1', session_id: session.session_id, user_id: USER, event_type: 'pushups', raw_value: 50,
      unit: 'reps', timestamp: '2026-11-07T12:00:00Z', source: 'app', detail: null, status: 'queued'
    });

    vi.stubGlobal('navigator', { onLine: true });
    const result = await syncQueue();

    expect(result.errors).toEqual([]);
    expect(remote.sessions.has(session.session_id)).toBe(true);
    expect(remote.events.has('e1')).toBe(true);
    expect(await queue.getPendingSessions()).toEqual([]);
    expect(await queue.getQueuedCount(session.session_id)).toBe(0);
  });

  it('keeps results queued while their session has not uploaded', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const session = await createSession(...sessionArgs);
    await queue.queueEvent({
      event_id: 'e2', session_id: session.session_id, user_id: USER, event_type: 'plank', raw_value: 80,
      unit: 's', timestamp: '2026-11-07T12:01:00Z', source: 'app', detail: null, status: 'queued'
    });

    vi.stubGlobal('navigator', { onLine: true });
    failNextSessionInsert = new TypeError('fetch failed');
    const result = await syncQueue();

    expect(result.errors[0]).toContain('session ' + session.session_id);
    expect(remote.events.size).toBe(0);
    expect(await queue.getQueuedCount(session.session_id)).toBe(1);
    expect((await queue.getPendingSessions()).length).toBe(1);
  });

  it('treats an earlier upload that already landed as success', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const session = await createSession(...sessionArgs);
    remote.sessions.set(session.session_id, { ...session, user_id: USER });

    vi.stubGlobal('navigator', { onLine: true });
    await syncQueue();

    expect(await queue.getPendingSessions()).toEqual([]);
  });

  it('refuses completion while the session is still only on this device', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const session = await createSession(...sessionArgs);

    vi.stubGlobal('navigator', { onLine: true });
    failNextSessionInsert = new TypeError('fetch failed');
    await expect(completeSession(session.session_id)).rejects.toThrow();
    expect(remote.sessions.has(session.session_id)).toBe(false);
  });
});
