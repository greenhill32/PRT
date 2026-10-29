import { createClient } from '@supabase/supabase-js';
import type { Event, Session } from './types';
import { COMPETITOR_MODEL_VERSION } from './competitors';
import { computeEffectiveRawResults } from './leaderboard';
import { appendIdempotently, errorMessage } from './eventPersistence';
import {
  cacheSession, getCachedSession, getCachedSessions, cacheSessionEvents,
  getCachedSessionEvents, cacheSyncedEvent
} from './queue';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing Supabase environment variables');
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const networkFailure = (error: unknown) =>
  (typeof navigator !== 'undefined' && !navigator.onLine)
  || /fetch|network|connection|timeout/i.test(errorMessage(error));

export async function createSession(
  kind: 'saturday_prt' | 'practice', competitor_seed: number,
  baseline_snapshot: any, competitor_snapshot: any
): Promise<Session> {
  const user = await getCurrentUser();
  if (!user) throw new Error('User not authenticated');
  const { data, error } = await supabase.from('sessions').insert([{
    user_id: user.id, kind, state: 'in_progress', scoring_version: '1.0',
    competitor_model_version: COMPETITOR_MODEL_VERSION, competitor_seed,
    baseline_snapshot, competitor_snapshot
  }]).select().single();
  if (error) throw error;
  await cacheSession(data);
  return data;
}

export async function getSession(session_id: string): Promise<Session> {
  const { data, error } = await supabase.from('sessions').select().eq('session_id', session_id).single();
  if (error) {
    if (networkFailure(error)) {
      const cached = await getCachedSession(session_id);
      const user = await getCurrentUser();
      if (cached && cached.user_id === user?.id) return cached;
    }
    throw error;
  }
  await cacheSession(data);
  return data;
}

export async function updateSessionState(session_id: string, state: 'completed'): Promise<void> {
  const { data, error } = await supabase.from('sessions')
    .update({ state, completed_at: new Date().toISOString() })
    .eq('session_id', session_id).eq('state', 'in_progress').select().maybeSingle();
  if (error) throw error;
  if (data) { await cacheSession(data); return; }
  // Idempotent completion after an uncertain network response.
  const existing = await getSession(session_id);
  if (existing.state !== 'completed') throw new Error('Session completion was blocked or session was not found.');
}

export async function getUserSessions(limit = 10): Promise<Session[]> {
  const { data, error } = await supabase.from('sessions').select()
    .order('started_at', { ascending: false }).limit(limit);
  if (error) {
    const user = await getCurrentUser();
    if (networkFailure(error) && user) return (await getCachedSessions(user.id))
      .sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit);
    throw error;
  }
  await Promise.all((data || []).map(cacheSession));
  return data || [];
}

export async function appendEvent(event: Omit<Event, 'created_at'>): Promise<Event> {
  const persisted = await appendIdempotently(event, async () => {
    const { data, error } = await supabase.from('events').insert([event]).select().single();
    if (error) throw error;
    return data;
  }, async id => {
    const { data, error } = await supabase.from('events').select().eq('event_id', id).maybeSingle();
    if (error) throw error;
    return data;
  });
  // Keep a durable local copy before the upload queue row is removed.
  await cacheSyncedEvent(persisted);
  return persisted;
}

export async function getSessionEvents(session_id: string): Promise<Event[]> {
  const { data, error } = await supabase.from('events').select().eq('session_id', session_id)
    .order('created_at', { ascending: true });
  if (error) {
    if (networkFailure(error)) {
      const session = await getCachedSession(session_id);
      const user = await getCurrentUser();
      if (session && session.user_id === user?.id) return getCachedSessionEvents(session_id);
    }
    throw error;
  }
  await cacheSessionEvents(session_id, data || []);
  return data || [];
}

export const computeEffectiveResultsFromEvents = computeEffectiveRawResults;
export async function getEffectiveResults(session_id: string) {
  return computeEffectiveRawResults(await getSessionEvents(session_id));
}

export async function getPriorSaturdays(limit = 5): Promise<Session[]> {
  const { data, error } = await supabase.from('sessions').select()
    .eq('kind', 'saturday_prt').eq('state', 'completed')
    .order('completed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function callCoach(session_id: string, question?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('coach', { body: { session_id, question } });
  if (error) throw error;
  return data.advice;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
export async function getCurrentUser() {
  // Cached auth permits opening a previously cached session when gym Wi-Fi drops.
  // Server requests still validate the JWT and apply RLS.
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
}
