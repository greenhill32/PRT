import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing Supabase environment variables');
}
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// Session operations
export async function createSession(kind, competitor_seed, baseline_snapshot, competitor_snapshot) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        throw new Error('User not authenticated');
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
    if (error)
        throw error;
    return data;
}
export async function getSession(session_id) {
    const { data, error } = await supabase
        .from('sessions')
        .select()
        .eq('session_id', session_id)
        .single();
    if (error)
        throw error;
    return data;
}
export async function updateSessionState(session_id, state) {
    const { error } = await supabase
        .from('sessions')
        .update({ state, completed_at: state === 'completed' ? new Date().toISOString() : null })
        .eq('session_id', session_id);
    if (error)
        throw error;
}
export async function getUserSessions(limit = 10) {
    const { data, error } = await supabase
        .from('sessions')
        .select()
        .eq('kind', 'saturday_prt')
        .order('started_at', { ascending: false })
        .limit(limit);
    if (error)
        throw error;
    return data || [];
}
// Event operations (append-only ledger)
export async function appendEvent(event) {
    const { data, error } = await supabase
        .from('events')
        .insert([event])
        .select()
        .single();
    if (error)
        throw error;
    return data;
}
export async function getSessionEvents(session_id) {
    const { data, error } = await supabase
        .from('events')
        .select()
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });
    if (error)
        throw error;
    return data || [];
}
// Compute effective results from ledger
export async function getEffectiveResults(session_id) {
    const events = await getSessionEvents(session_id);
    const results = {};
    const eventTypes = ['pushups', 'plank', 'row_2k', 'bike'];
    for (const eventType of eventTypes) {
        // Get all non-void events of this type, sorted by creation time
        const relevantEvents = events
            .filter((e) => e.event_type === eventType && e.event_type !== 'void')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
export async function getPriorSaturdays(limit = 5) {
    const { data, error } = await supabase
        .from('sessions')
        .select()
        .eq('kind', 'saturday_prt')
        .eq('state', 'completed')
        .order('completed_at', { ascending: false })
        .limit(limit);
    if (error)
        throw error;
    return data || [];
}
// Coach endpoint call
export async function callCoach(session_id, question) {
    const { data, error } = await supabase.functions.invoke('coach', {
        body: { session_id, question }
    });
    if (error)
        throw error;
    return data.advice;
}
// Auth
export async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error)
        throw error;
    return data;
}
export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    if (error)
        throw error;
    return data;
}
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error)
        throw error;
}
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        callback(session?.user || null);
    });
}
