import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getProgressHistory, readAllPages } from './progressData';
import { supabase } from './supabase';
import { cacheProgressHistory } from './queue';
import { savedSession, savedEvents } from './test/progressFixtures';
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));
beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(supabase.from).mockReset();
});
describe('Complete progress history loading', () => {
  it('reads every actual page, even when a server returns fewer rows than requested', async () => {
    const all = Array.from({ length: 1001 }, (_, i) => i);
    const values = await readAllPages<number>(async from => ({ data: all.slice(from, from + 37), error: null }));
    expect(values).toEqual(all);
  });
  it('loads owned completed history and all ledger rows, independent of Recent Sessions', async () => {
    const sessions = Array.from({ length: 12 }, (_, i) => savedSession('load-' + i, '2026-10-01T10:00:00Z'));
    const events = sessions.flatMap(s => savedEvents(s));
    const queries: any[] = [];
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const state: any = { table, filters: [], ids: null, from: 0, to: 499 };
      queries.push(state);
      const query: any = {
        select: () => query, eq: (key: string, value: string) => { state.filters.push([key, value]); return query; },
        lte: () => query, order: () => query, abortSignal: () => query,
        in: (_key: string, ids: string[]) => { state.ids = ids; return query; },
        range: (from: number, to: number) => { state.from = from; state.to = to; return query; },
        then: (resolve: any) => {
          const pool = table === 'sessions' ? sessions : events.filter(e => state.ids.includes(e.session_id));
          return Promise.resolve({ data: pool.slice(state.from, Math.min(state.to + 1, state.from + 4)), error: null }).then(resolve);
        }
      };
      return query;
    });
    const history = await getProgressHistory('owner');
    expect(history.sessions).toHaveLength(12);
    expect(history.events).toHaveLength(36);
    expect(queries.filter(q => q.table === 'sessions').every(q => q.filters.some(([key, value]) => key === 'user_id' && value === 'owner'))).toBe(true);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const offline = await getProgressHistory('owner');
    expect(offline.source).toBe('cache');
    expect(offline.sessions).toHaveLength(12);
  });
  it('does not present a partial Recent Sessions cache as a full offline history', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await expect(getProgressHistory('uncached-user')).rejects.toThrow('Connect once');
  });
  it('keeps cached history isolated by account and does not hide authorization failures', async () => {
    await cacheProgressHistory('cache-owner', { sessions: [], events: [], fetchedAt: '2026-10-29T10:00:00Z' });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await expect(getProgressHistory('different-user')).rejects.toThrow();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.mocked(supabase.from).mockImplementation(() => {
      const query: any = { select: () => query, eq: () => query, lte: () => query, order: () => query, range: () => query,
        then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'Unauthorized', code: '401' } }).then(resolve) };
      return query;
    });
    await expect(getProgressHistory('cache-owner')).rejects.toEqual({ message: 'Unauthorized', code: '401' });
  });
});
