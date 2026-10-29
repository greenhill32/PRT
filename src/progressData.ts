import { supabase } from './supabase';
import { cacheProgressHistory, getCachedProgressHistory } from './queue';
import type { CachedProgressHistory } from './queue';
import { errorMessage } from './eventPersistence';
import type { Event, Session } from './types';

export interface ProgressHistory extends CachedProgressHistory {
  source: 'server' | 'cache';
  warning?: string;
}
const PAGE_SIZE = 500;
interface Page<T> { data: T[] | null; error: unknown }

// Advance by the actual number returned, including when a server row cap is
// smaller than our requested page. Read through an empty page: never silently
// truncate Year/All time to Recent Sessions or to the first API page.
export async function readAllPages<T>(query: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await query(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    offset += data.length;
  }
}

export async function getProgressHistory(userId: string, signal?: AbortSignal): Promise<ProgressHistory> {
  if (!userId) throw new Error('Sign in to view progress.');
  const cached = () => getCachedProgressHistory(userId);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const history = await cached();
    if (!history) throw new Error('Connect once to load your complete progress history.');
    return { ...history, source: 'cache' };
  }
  try {
    const fetchedAt = new Date().toISOString();
    const sessions = await readAllPages<Session>((from, to) => {
      let query = supabase.from('sessions').select('*')
        .eq('user_id', userId).eq('state', 'completed').lte('completed_at', fetchedAt)
        .order('started_at', { ascending: false }).order('session_id', { ascending: false }).range(from, to);
      if (signal) query = query.abortSignal(signal);
      return query;
    });
    if (sessions.some(session => session.user_id !== userId)) throw new Error('Unexpected session owner in progress data.');
    const byId = new Map(sessions.map(session => [session.session_id, session]));
    const ids = [...byId.keys()];
    const events: Event[] = [];
    for (let index = 0; index < ids.length; index += 50) {
      events.push(...await readAllPages<Event>((from, to) => {
        let query = supabase.from('events').select('*')
          .in('session_id', ids.slice(index, index + 50))
          .order('event_id', { ascending: true }).range(from, to);
        if (signal) query = query.abortSignal(signal);
        return query;
      }));
    }
    const history = { sessions: [...byId.values()],
      events: [...new Map(events.filter(event => byId.has(event.session_id)).map(event => [event.event_id, event])).values()], fetchedAt };
    if (signal?.aborted) throw new Error('Progress loading cancelled.');
    try { await cacheProgressHistory(userId, history); }
    catch { return { ...history, source: 'server', warning: 'Progress loaded, but the offline copy could not be saved.' }; }
    return { ...history, source: 'server' };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (/fetch|network|connection|timeout/i.test(errorMessage(error))) {
      const history = await cached();
      if (history) return { ...history, source: 'cache' };
    }
    throw error;
  }
}
