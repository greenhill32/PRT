import { describe, it, expect } from 'vitest';
import { eventPoints, composite, navyScoring1_0 as ctx } from './scoring';
import { computeEffectiveResults, buildLeaderboard } from './leaderboard';
import { generateCompetitors, generateBaseline } from './competitors';
import { buildCoachContext } from '../supabase/functions/_shared/coachContext';
import { parseEventInput, mergeSessionEvents, nextMissingEvent } from './sessionState';
import { appendIdempotently } from './eventPersistence';
import type { Event, Session } from './types';

const raw = { pushups: 38, plank: 122, row_2k: 530 };
const competitors = { peer: raw, steady: raw, volatile: raw, rival: raw, ghost_you: null };
const session = { session_id: 's', kind: 'saturday_prt', scoring_version: '1.0', competitor_snapshot: competitors } as Session;
const event = (type: 'pushups' | 'plank' | 'row_2k', value: number): Event => ({
  event_id: type, session_id: 's', event_type: type, raw_value: value,
  unit: type === 'pushups' ? 'reps' : 's', timestamp: '2026-10-29T12:00:00Z',
  created_at: '2026-10-29T12:00:00Z', source: 'app', detail: null, correction_of: null, voids_event_id: null
});

describe('Scoring and leaderboard regressions', () => {
  it('interpolates slow rows continuously through the below-minimum range', () => {
    expect([570, 571, 600, 900, 1140, 1200].map(v => eventPoints('row_2k', v, ctx)))
      .toEqual([60, 60, 57, 25, 0, 0]);
    let previous = 100;
    for (let seconds = 1; seconds <= 1200; seconds++) {
      const score = eventPoints('row_2k', seconds, ctx);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });
  it('does not award 100 points for an impossible zero row time or NaN', () => {
    expect(eventPoints('row_2k', 0, ctx)).toBe(0);
    expect(eventPoints('plank', NaN, ctx)).toBe(0);
  });
  it('counts zero-point events equally for the user, rivals and coach', () => {
    const events = [event('pushups', 38), event('plank', 122), event('row_2k', 1140)];
    const low = { ...raw, row_2k: 1140 };
    const snapshot = { peer: low, steady: low, volatile: low, rival: low, ghost_you: low };
    const lb = buildLeaderboard(computeEffectiveResults(events), snapshot, new Set(['pushups', 'plank', 'row_2k']));
    expect(lb.every(row => row.overall_score === 47)).toBe(true);
    expect(buildCoachContext({ ...session, competitor_snapshot: snapshot }, events).leaderboard).toEqual(lb);
  });
  it('keeps unrevealed results out of both the frontend and coach context', () => {
    const events = [event('pushups', 38)];
    const coach = buildCoachContext(session, events);
    expect(coach.leaderboard).toEqual(buildLeaderboard(computeEffectiveResults(events), competitors, new Set(['pushups'])));
    expect(coach.leaderboard.find(row => row.name === 'Rival')?.plank).toBeUndefined();
  });
  it('resolves corrections regardless of upload order', () => {
    const original = event('pushups', 38);
    const corrected = { ...original, event_id: 'new', raw_value: 42, correction_of: original.event_id };
    const voided = { ...original, event_id: 'void', event_type: 'void' as const, raw_value: null, voids_event_id: original.event_id };
    expect(computeEffectiveResults([corrected, voided, original]).pushups?.raw_value).toBe(42);
  });
});

describe('Rival distributions', () => {
  it('is deterministic and keeps the Ghost fixed', () => {
    const baseline = { pushups_median: 38, plank_median_sec: 122, row_median_sec: 530 };
    expect(generateCompetitors(baseline, 42, raw)).toEqual(generateCompetitors(baseline, 42, raw));
    expect(generateCompetitors(baseline, 42, raw).ghost_you).toEqual(raw);
  });
  it('is slightly stronger on average and beatable across good/bad days', () => {
    const baseline = { pushups_median: 38, plank_median_sec: 122, row_median_sec: 530 };
    const rivals = Array.from({ length: 10000 }, (_, seed) => generateCompetitors(baseline, seed).rival);
    const mean = (key: keyof typeof raw) => rivals.reduce((sum, r) => sum + r[key], 0) / rivals.length;
    expect(mean('pushups')).toBeGreaterThan(38);
    expect(mean('pushups')).toBeLessThan(41);
    expect(mean('plank')).toBeGreaterThan(122);
    expect(mean('plank')).toBeLessThan(132);
    expect(mean('row_2k')).toBeLessThan(530);
    expect(mean('row_2k')).toBeGreaterThan(510);
    const wins = rivals.filter(r => composite(raw, ctx) > composite(r, ctx)).length / rivals.length;
    expect(wins).toBeGreaterThan(0.15);
    expect(wins).toBeLessThan(0.5);
    expect(new Set(rivals.map(r => r.row_2k)).size).toBeGreaterThan(100);
  });
  it('includes real zero-rep results in the baseline', () => {
    expect(generateBaseline([{ pushups: 0 }, { pushups: 10 }]).pushups_median).toBe(5);
  });
});

describe('Input and recovery', () => {
  it('accepts whole seconds and mm:ss, including zero push-ups', () => {
    expect(parseEventInput('2:02', 'plank')).toBe(122);
    expect(parseEventInput('530', 'row_2k')).toBe(530);
    expect(parseEventInput('0', 'pushups')).toBe(0);
  });
  it.each(['2:99', '2:-1', '2:02junk', 'abc', '1.5', '-1', '1:2:3'])('rejects malformed time %s', input => {
    expect(() => parseEventInput(input, 'plank')).toThrow();
  });
  it('rejects zero row times and time-shaped push-up counts', () => {
    expect(() => parseEventInput('0', 'row_2k')).toThrow();
    expect(() => parseEventInput('1:00', 'pushups')).toThrow();
  });
  it('merges server and unsynced rows once and advances to the actual next event', () => {
    const server = event('pushups', 38);
    const local = { ...event('plank', 122), source: 'app' as const, status: 'error' as const };
    const merged = mergeSessionEvents('s', [server], [local, { ...server, source: 'app', status: 'queued' }]);
    expect(merged).toHaveLength(2);
    expect(nextMissingEvent(merged)).toBe('row_2k');
    expect(computeEffectiveResults(merged).plank?.raw_value).toBe(122);
  });
});

describe('Idempotent inserts', () => {
  it('verifies plain PostgREST duplicate errors by UUID and payload', async () => {
    const row = event('pushups', 38);
    const insert = async () => { throw { code: '23505', message: 'duplicate key' }; };
    expect(await appendIdempotently(row, insert, async () => row)).toEqual(row);
    await expect(appendIdempotently(row, insert, async () => ({ ...row, raw_value: 39 }))).rejects.toThrow('different data');
    await expect(appendIdempotently(row, insert, async () => null)).rejects.toThrow();
  });
});
