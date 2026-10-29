import { createClient } from '@supabase/supabase-js';
import type { Event, Session } from './types';

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Session operations
export async function createSession(
  kind: 'saturday_prt' | 'practice',
  competitor_seed: number,
  baseline_snapshot: any,
  competitor_snapshot: any
): Promise<Session> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('sessions')
    .insert([
      {
        user_id: user.id,
        kind,
        state: 'in_progress',
        scoring_version: '1.0',
        competitor_model_version: '1.0',
        competitor_seed,
        baseline_snapshot,
        competitor_snapshot
      }
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSession(session_id: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('session_id', session_id)
    .single();

  if (error) throw error;
  return data;
}

export async function updateSessionState(
  session_id: string,
  state: 'in_progress' | 'completed'
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ state, completed_at: state === 'completed' ? new Date().toISOString() : null })
    .eq('session_id', session_id);

  if (error) throw error;
}

export async function getUserSessions(limit: number = 10): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('kind', 'saturday_prt')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Event operations (append-only ledger)
export async function appendEvent(event: Omit<Event, 'created_at'>): Promise<Event> {
  const { data, error } = await supabase
    .from('events')
    .insert([event])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getSessionEvents(session_id: string): Promise<Event[]> {
  const { data, error } = await supabase
    .from('events')
    .select()
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Compute effective results from ledger
export async function getEffectiveResults(session_id: string): Promise<{
  pushups?: number;
  plank?: number;
  row_2k?: number;
  bike?: number;
}> {
  const events = await getSessionEvents(session_id);

  const results: any = {};
  const eventTypes = ['pushups', 'plank', 'row_2k', 'bike'];

  for (const eventType of eventTypes) {
    // Get all non-void events of this type, sorted by creation time
    const relevantEvents = events
      .filter((e) => e.event_type === eventType && e.event_type !== 'void')
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

    // Skip if voided
    for (const evt of relevantEvents) {
      const isVoided = events.some((e) => e.voids_event_id === evt.event_id);
      if (!isVoided && evt.raw_value !== null) {
        results[eventType] = evt.raw_value;
        break;
      }
    }
  }

  return results;
}

// Get past sessions for baseline calculation
export async function getPriorSaturdays(limit: number = 5): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('kind', 'saturday_prt')
    .eq('state', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Coach endpoint call
export async function callCoach(session_id: string, question?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('coach', {
    body: { session_id, question }
  });

  if (error) throw error;
  return data.advice;
}

// Auth
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null);
  });
}
