// Pure planning for importing a workout recorded outside the app.
// IDs are deterministic UUIDv5 values, so re-running the same import matches the
// rows already written instead of duplicating them.
import { v5 as uuidv5 } from 'uuid';
import type { AccessoryDetail, Event, Session } from './types';

// Fixed namespace for PRT import identifiers. Changing it changes every planned ID.
export const IMPORT_NAMESPACE = '6f1c2b1e-8d3a-5e4f-9b7c-2a1d0e5f4c3b';

export interface AccessoryEntry extends AccessoryDetail {}

export interface WorkoutImport {
  date: string; // YYYY-MM-DD, UK calendar date
  start_time_utc: string; // HH:MM, placeholder unless the real time is known
  pushups_reps: number;
  plank_sec: number;
  row_2k_sec: number;
  row_notes?: string;
  accessories: AccessoryEntry[];
}

export interface ImportPlan {
  session: Omit<Session, 'created_at'>;
  events: Omit<Event, 'created_at'>[];
}

const isWhole = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;

export function validateWorkout(workout: WorkoutImport): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workout.date)) problems.push('date must be YYYY-MM-DD');
  else if (new Date(`${workout.date}T00:00:00Z`).getUTCDay() !== 6) problems.push('date must be a Saturday');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workout.start_time_utc)) problems.push('start_time_utc must be HH:MM');
  if (!isWhole(workout.pushups_reps, 0, 500)) problems.push('pushups_reps must be 0–500');
  if (!isWhole(workout.plank_sec, 0, 3600)) problems.push('plank_sec must be 0–3600');
  if (!isWhole(workout.row_2k_sec, 1, 3600)) problems.push('row_2k_sec must be 1–3600');
  for (const [index, entry] of workout.accessories.entries()) {
    if (!entry.exercise.trim()) problems.push(`accessory ${index}: exercise name required`);
    if (!(Number.isFinite(entry.load_kg) && entry.load_kg >= 0)) problems.push(`accessory ${index}: load_kg must be ≥ 0`);
    if (!isWhole(entry.sets, 1, 50)) problems.push(`accessory ${index}: sets must be 1–50`);
    if (!isWhole(entry.reps_per_set, 1, 500)) problems.push(`accessory ${index}: reps_per_set must be 1–500`);
  }
  return problems;
}

const at = (date: string, time: string, minutesAfter: number) => {
  const base = new Date(`${date}T${time}:00.000Z`).getTime();
  return new Date(base + minutesAfter * 60_000).toISOString();
};

export function buildImportPlan(userId: string, workout: WorkoutImport): ImportPlan {
  const problems = validateWorkout(workout);
  if (problems.length) throw new Error('Invalid workout: ' + problems.join('; '));

  const sessionId = uuidv5(`session:${userId}:${workout.date}:saturday_prt`, IMPORT_NAMESPACE);
  const startedAt = at(workout.date, workout.start_time_utc, 0);
  // Competitors cannot be reconstructed for a past session, so the snapshot is recorded as empty.
  const session: ImportPlan['session'] = {
    session_id: sessionId, user_id: userId, kind: 'saturday_prt', started_at: startedAt,
    completed_at: at(workout.date, workout.start_time_utc, 30), state: 'completed',
    scoring_version: '1.0', competitor_model_version: '2.0', competitor_seed: 0,
    baseline_snapshot: null, competitor_snapshot: {} as Session['competitor_snapshot']
  };

  const eventId = (key: string) => uuidv5(`event:${userId}:${workout.date}:${key}`, IMPORT_NAMESPACE);
  const base = { session_id: sessionId, source: 'app' as const, correction_of: null, voids_event_id: null };

  const events: ImportPlan['events'] = [
    { ...base, event_id: eventId('pushups'), event_type: 'pushups', raw_value: workout.pushups_reps,
      unit: 'reps', timestamp: at(workout.date, workout.start_time_utc, 0), detail: null },
    { ...base, event_id: eventId('plank'), event_type: 'plank', raw_value: workout.plank_sec,
      unit: 's', timestamp: at(workout.date, workout.start_time_utc, 10), detail: null },
    { ...base, event_id: eventId('row_2k'), event_type: 'row_2k', raw_value: workout.row_2k_sec,
      unit: 's', timestamp: at(workout.date, workout.start_time_utc, 20),
      detail: workout.row_notes ? { notes: workout.row_notes } : null },
    ...workout.accessories.map((entry, index) => ({
      ...base, event_id: eventId(`accessory:${index}`), event_type: 'accessory' as const,
      raw_value: entry.sets * entry.reps_per_set, unit: 'reps' as const,
      timestamp: at(workout.date, workout.start_time_utc, 30 + index),
      detail: {
        exercise: entry.exercise, load_kg: entry.load_kg, sets: entry.sets,
        reps_per_set: entry.reps_per_set, tempo: entry.tempo
      }
    }))
  ];

  return { session, events };
}
