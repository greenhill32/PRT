// One-off, idempotent import of a workout recorded outside the app.
//
//   Dry run (default, no writes):
//     npx vite-node scripts/import-workout.ts
//   Write (only after the dry run is reviewed):
//     npx vite-node scripts/import-workout.ts -- --execute
//
// Required environment (never commit these values):
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY          the project the app uses
//   EXPECTED_PROJECT_REF                            must match the URL's project ref
//   IMPORT_EMAIL, IMPORT_PASSWORD                   the account that owns the history
//   EXPECTED_USER_ID                                must match the signed-in user's id
// Optional: WORKOUT_FILE (defaults to scripts/data/2026-11-07.workout.json)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { buildImportPlan, validateWorkout, type WorkoutImport } from '../src/workoutImport';
import { appendIdempotently, errorMessage, sameEventPayload } from '../src/eventPersistence';
import type { Event } from '../src/types';

const execute = process.argv.includes('--execute');
const env = process.env;

function fail(message: string): never {
  console.error(`ABORTED: ${message}`);
  process.exit(1);
}

const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'EXPECTED_PROJECT_REF',
  'IMPORT_EMAIL', 'IMPORT_PASSWORD', 'EXPECTED_USER_ID'];
const missing = required.filter(name => !env[name]);
if (missing.length) fail(`missing environment: ${missing.join(', ')}`);

const projectRef = new URL(env.SUPABASE_URL!).hostname.split('.')[0];
if (projectRef !== env.EXPECTED_PROJECT_REF) fail('SUPABASE_URL is not the expected project');

const workoutFile = env.WORKOUT_FILE || 'scripts/data/2026-11-07.workout.json';
const workout = JSON.parse(readFileSync(workoutFile, 'utf8')) as WorkoutImport;
const problems = validateWorkout(workout);
if (problems.length) fail('invalid workout file: ' + problems.join('; '));

const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: env.IMPORT_EMAIL!, password: env.IMPORT_PASSWORD!
});
if (authError || !auth.user) fail('sign-in failed: ' + (authError ? errorMessage(authError) : 'no user'));
const userId = auth.user.id;
if (userId !== env.EXPECTED_USER_ID) fail('signed-in user does not match EXPECTED_USER_ID');

const plan = buildImportPlan(userId, workout);
const sessionId = plan.session.session_id;

// Any other Saturday session on this date means a human must decide what to do.
const dayStart = `${workout.date}T00:00:00Z`;
const dayEnd = new Date(new Date(dayStart).getTime() + 86_400_000).toISOString();
const { data: sameDay, error: dayError } = await supabase.from('sessions').select('session_id, kind, state')
  .eq('kind', 'saturday_prt').gte('started_at', dayStart).lt('started_at', dayEnd);
if (dayError) fail('could not read sessions: ' + errorMessage(dayError));
const otherSessions = (sameDay ?? []).filter(s => s.session_id !== sessionId);
if (otherSessions.length) fail(`${otherSessions.length} other Saturday session(s) exist on ${workout.date}; resolve manually`);

const { data: existingSession, error: sessionError } = await supabase.from('sessions').select()
  .eq('session_id', sessionId).maybeSingle();
if (sessionError) fail('could not read session: ' + errorMessage(sessionError));

const { data: existingEvents, error: eventsError } = await supabase.from('events').select()
  .eq('session_id', sessionId);
if (eventsError) fail('could not read events: ' + errorMessage(eventsError));

const plannedIds = new Set(plan.events.map(e => e.event_id));
const unexpected = (existingEvents ?? []).filter(e => !plannedIds.has(e.event_id));
if (unexpected.length) fail(`session already has ${unexpected.length} event(s) not in this import; resolve manually`);

const eventActions = plan.events.map(planned => {
  const existing = (existingEvents as Event[] ?? []).find(e => e.event_id === planned.event_id);
  if (!existing) return { planned, action: 'insert' as const };
  if (!sameEventPayload(planned, existing)) fail(`event ${planned.event_id} exists with different data`);
  return { planned, action: 'already-present' as const };
});
const sessionAction = existingSession ? 'already-present' : 'insert';

console.log(`User: verified (${userId.slice(0, 8)}…)`);
console.log(`Session ${sessionId.slice(0, 8)}… (${workout.date}, saturday_prt, completed): ${sessionAction}`);
for (const { planned, action } of eventActions) {
  const value = planned.unit === 's' ? `${planned.raw_value} s` : `${planned.raw_value} ${planned.unit}`;
  const label = planned.event_type === 'accessory'
    ? `accessory ${(planned.detail as { exercise: string }).exercise} ${(planned.detail as { load_kg: number }).load_kg}kg`
    : planned.event_type;
  console.log(`  ${action.padEnd(16)} ${label} = ${value}`);
}

if (!execute) {
  console.log('\nDry run only. No rows written. Re-run with -- --execute to write.');
  await supabase.auth.signOut();
  process.exit(0);
}

if (sessionAction === 'insert') {
  const { error } = await supabase.from('sessions').insert([plan.session]);
  if (error) fail('session insert failed: ' + errorMessage(error));
}
for (const { planned, action } of eventActions) {
  if (action !== 'insert') continue;
  await appendIdempotently(planned, async () => {
    const { data, error } = await supabase.from('events').insert([planned]).select().single();
    if (error) throw error;
    return data;
  }, async id => {
    const { data, error } = await supabase.from('events').select().eq('event_id', id).maybeSingle();
    if (error) throw error;
    return data;
  });
}

// Verify what is now persisted, rather than trusting the write responses.
const { data: finalEvents, error: finalError } = await supabase.from('events').select().eq('session_id', sessionId);
if (finalError) fail('verification read failed: ' + errorMessage(finalError));
for (const planned of plan.events) {
  const persisted = (finalEvents as Event[]).find(e => e.event_id === planned.event_id);
  if (!persisted || !sameEventPayload(planned, persisted)) fail(`verification failed for ${planned.event_id}`);
}
console.log(`\nImport complete: ${plan.events.length} event(s) verified. Re-running is safe and writes nothing new.`);
await supabase.auth.signOut();
