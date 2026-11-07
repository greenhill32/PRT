import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildImportPlan, validateWorkout, type WorkoutImport } from './workoutImport';
import { computeEffectiveRawResults } from '../supabase/functions/_shared/leaderboard';

const USER = '11111111-1111-4111-8111-111111111111';
const workout = JSON.parse(readFileSync(new URL('../scripts/data/2026-11-07.workout.json', import.meta.url), 'utf8')) as WorkoutImport;

describe('validateWorkout', () => {
  it('accepts the recorded 7 November 2026 workout', () => {
    expect(validateWorkout(workout)).toEqual([]);
  });

  it('rejects a non-Saturday date', () => {
    expect(validateWorkout({ ...workout, date: '2026-11-06' })).toContain('date must be a Saturday');
  });

  it('rejects out-of-range PRT values', () => {
    const problems = validateWorkout({ ...workout, pushups_reps: 501, row_2k_sec: 0 });
    expect(problems).toEqual(expect.arrayContaining(['pushups_reps must be 0–500', 'row_2k_sec must be 1–3600']));
  });
});

describe('buildImportPlan', () => {
  const plan = buildImportPlan(USER, workout);

  it('is deterministic, so a re-run targets the same rows', () => {
    const again = buildImportPlan(USER, workout);
    expect(again.session.session_id).toBe(plan.session.session_id);
    expect(again.events.map(e => e.event_id)).toEqual(plan.events.map(e => e.event_id));
  });

  it('gives different IDs for a different user', () => {
    const other = buildImportPlan('22222222-2222-4222-8222-222222222222', workout);
    expect(other.session.session_id).not.toBe(plan.session.session_id);
  });

  it('records the PRT results with their recorded units', () => {
    const byType = Object.fromEntries(plan.events.filter(e => e.event_type !== 'accessory')
      .map(e => [e.event_type, { raw: e.raw_value, unit: e.unit }]));
    expect(byType).toEqual({
      pushups: { raw: 50, unit: 'reps' },
      plank: { raw: 80, unit: 's' },
      row_2k: { raw: 653, unit: 's' }
    });
  });

  it('keeps the row pause as a note and leaves the other events without detail', () => {
    const row = plan.events.find(e => e.event_type === 'row_2k');
    expect(row?.detail).toEqual({ notes: '1 pause during 2,000m (10:53 total)' });
    expect(plan.events.find(e => e.event_type === 'pushups')?.detail).toBeNull();
  });

  it('stores each accessory with structured detail and total reps', () => {
    const accessories = plan.events.filter(e => e.event_type === 'accessory');
    expect(accessories.map(e => [e.raw_value, e.detail])).toEqual([
      [8, { exercise: 'lat_pulldown', load_kg: 32, sets: 2, reps_per_set: 4, tempo: '4-4-4 (concentric-hold-eccentric, seconds)' }],
      [4, { exercise: 'incline_chest_press', load_kg: 20, sets: 1, reps_per_set: 4, tempo: '4-4-4 (concentric-hold-eccentric, seconds)' }],
      [4, { exercise: 'incline_chest_press', load_kg: 25, sets: 1, reps_per_set: 4, tempo: '4-4-4 (concentric-hold-eccentric, seconds)' }]
    ]);
  });

  it('marks the session as a completed Saturday PRT with no competitor snapshot', () => {
    expect(plan.session).toMatchObject({
      user_id: USER, kind: 'saturday_prt', state: 'completed', competitor_snapshot: {}
    });
    expect(plan.session.completed_at).not.toBeNull();
  });

  it('does not let accessory work change the PRT scoring results', () => {
    const events = plan.events.map(e => ({ ...e, created_at: e.timestamp }));
    expect(computeEffectiveRawResults(events)).toEqual({ pushups: 50, plank: 80, row_2k: 653 });
  });
});
