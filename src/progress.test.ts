import { describe, it, expect } from 'vitest';
import {
  periodBounds, shiftPeriod, createProgressRecords, selectProgressRecords, previousRecords,
  progressSummary, eventStatistics, buildLeague, chartValues, sessionFinish
} from './progress';
import { savedSession, savedEvents, RESULTS } from './test/progressFixtures';

const record = (id: string, date: string, kind: 'saturday_prt' | 'practice' = 'saturday_prt') => {
  const session = savedSession(id, date, kind);
  return createProgressRecords([session], savedEvents(session))[0];
};
describe('UK calendar periods', () => {
  it('uses Monday boundaries and includes the extra hour when summer time ends', () => {
    const bounds = periodBounds('week', new Date('2026-10-25T12:00:00Z'))!;
    expect(new Date(bounds.start).toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(new Date(bounds.end).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect((bounds.end - bounds.start) / 3600000).toBe(169);
  });
  it('handles spring and autumn month boundaries', () => {
    const march = periodBounds('month', new Date('2026-03-15T12:00:00Z'))!;
    expect(new Date(march.start).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(new Date(march.end).toISOString()).toBe('2026-03-31T23:00:00.000Z');
    const october = periodBounds('month', new Date('2026-10-15T12:00:00Z'))!;
    expect(new Date(october.start).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(new Date(october.end).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
  it('handles leap years and Jan 31 month navigation without skipping February', () => {
    const feb = periodBounds('month', shiftPeriod(new Date('2024-01-31T12:00:00Z'), 'month', 1))!;
    expect((feb.end - feb.start) / 86400000).toBe(29);
  });
  it('includes the start and excludes the end, using the London workout date', () => {
    const records = [record('before', '2026-09-30T22:59:59Z'), record('start', '2026-09-30T23:00:00Z'), record('end', '2026-11-01T00:00:00Z')];
    expect(selectProgressRecords(records, 'month', new Date('2026-10-15')).map(r => r.session.session_id)).toEqual(['start']);
  });
});
describe('Recorded progress and comparisons', () => {
  it('ignores in-progress sessions, honours voids/corrections, and retains zero results', () => {
    const session = savedSession('s', '2026-10-03T10:00:00Z');
    const events = savedEvents(session, { ...RESULTS, pushups: 0 });
    const voided = { ...events[1], event_id: 'void', event_type: 'void' as const, raw_value: null, voids_event_id: events[1].event_id };
    const corrected = { ...events[1], event_id: 'fixed', raw_value: 130, correction_of: events[1].event_id };
    const records = createProgressRecords([session, { ...session, session_id: 'pending', state: 'in_progress' }], [...events, voided, corrected]);
    expect(records).toHaveLength(1);
    expect(records[0].results).toEqual({ ...RESULTS, pushups: 0, plank: 130 });
    expect(records[0].score).not.toBeNull();
  });
  it('flags partial/unknown-scoring history without inventing composite scores', () => {
    const partial = savedSession('partial', '2026-10-01T10:00:00Z');
    const unsupported = { ...savedSession('unknown', '2026-10-02T10:00:00Z'), scoring_version: 'unknown' };
    const records = createProgressRecords([partial, unsupported], [...savedEvents(partial).slice(0, 1), ...savedEvents(unsupported)]);
    expect(records.map(r => r.issue)).toEqual(['incomplete', 'unsupported']);
    expect(progressSummary(records, []).average).toBeNull();
    expect(buildLeague(records).counted).toBe(0);
  });
  it('keeps practice opt-in for fitness statistics and out of the league', () => {
    const records = [record('prt', '2026-10-03T10:00:00Z'), record('practice', '2026-10-04T10:00:00Z', 'practice')];
    expect(selectProgressRecords(records, 'all', new Date())).toHaveLength(1);
    expect(selectProgressRecords(records, 'all', new Date(), true)).toHaveLength(2);
    expect(buildLeague(records).counted).toBe(1);
  });
  it('uses the previous session of the same kind and handles a first session', () => {
    const records = [record('old-prt', '2026-09-01T10:00:00Z'), record('practice', '2026-09-02T10:00:00Z', 'practice'), record('new-prt', '2026-10-03T10:00:00Z')];
    expect(previousRecords(records, [records[2]], 'session', new Date(), false)[0].session.session_id).toBe('old-prt');
    expect(previousRecords(records, [records[0]], 'session', new Date(), false)).toEqual([]);
  });
  it('calculates event averages/bests with zero reps and faster rowing as improvement', () => {
    const first = savedSession('first', '2026-09-01T10:00:00Z');
    const second = savedSession('second', '2026-10-01T10:00:00Z');
    const third = savedSession('third', '2026-10-02T10:00:00Z');
    const prior = createProgressRecords([first], savedEvents(first));
    const selected = createProgressRecords([second, third], [...savedEvents(second, { ...RESULTS, pushups: 0, row_2k: 520 }), ...savedEvents(third)]);
    const stats = eventStatistics(selected, prior);
    expect(stats[0].average).toBe(19);
    expect(stats[2].best).toBe(520);
    expect(stats[2].improvement).toBe(5);
    expect(progressSummary(selected, prior).rowDistanceKm).toBe(4);
    expect(progressSummary(selected, prior).recordedPushups).toBe(38);
  });
  it('calculates more than the ten Recent Sessions entries', () => {
    const records = Array.from({ length: 20 }, (_, i) => record('s' + i, '2026-10-' + String(i + 1).padStart(2, '0') + 'T10:00:00Z'));
    expect(progressSummary(selectProgressRecords(records, 'year', new Date('2026-10-29')), []).count).toBe(20);
  });
});
describe('Cumulative league', () => {
  it('derives 5/4/3/2/1 points from stored snapshots and excludes Ghost', () => {
    const league = buildLeague([record('one', '2026-10-01T10:00:00Z'), record('two', '2026-10-02T10:00:00Z')]);
    expect(league.rows.map(r => [r.name, r.points])).toEqual([['Volatile', 10], ['Rival', 8], ['You', 6], ['Peer', 4], ['Steady', 2]]);
    expect(league.rows.every(r => r.played === 2)).toBe(true);
    expect(league.rows.find(r => r.key === 'you')?.averageScore).toBe(70);
  });
  it('shares occupied-place points on a tie and preserves 15 total points', () => {
    const item = record('tie', '2026-10-01T10:00:00Z');
    item.session.competitor_snapshot.peer = RESULTS;
    const league = buildLeague([item]);
    expect(league.rows.find(r => r.key === 'you')?.points).toBe(2.5);
    expect(league.rows.find(r => r.key === 'peer')?.points).toBe(2.5);
    expect(league.rows.reduce((sum, r) => sum + r.points, 0)).toBe(15);
    expect(league.rows.find(r => r.key === 'peer')?.rank).toBe(3);
  });
  it('counts a shared first as a win, while keeping points shared fairly', () => {
    const item = record('tie-top', '2026-10-01T10:00:00Z');
    item.session.competitor_snapshot.volatile = RESULTS;
    item.session.competitor_snapshot.rival = RESULTS;
    const league = buildLeague([item]);
    expect(league.rows.find(r => r.key === 'you')?.wins).toBe(1);
    expect(league.rows.find(r => r.key === 'you')?.points).toBe(4);
  });
  it('does not invent opponents for a missing snapshot or include incomplete PRTs', () => {
    const item = record('broken', '2026-10-01T10:00:00Z');
    item.session.competitor_snapshot = {} as any;
    expect(buildLeague([item])).toEqual({ rows: [], counted: 0, skipped: 1 });
  });
  it('keeps the saved-session finish distinct from league positions, including Ghost', () => {
    expect(sessionFinish(record('one', '2026-10-01T10:00:00Z'))).toEqual({ rank: 4, total: 6, tied: false });
  });
});
describe('Charts', () => {
  it('includes zero scores and shows a single real point without fabricated history', () => {
    const item = record('zero', '2026-10-01T10:00:00Z'); item.score = 0;
    expect(chartValues([item], 'score', 'session')).toHaveLength(1);
    expect(chartValues([item], 'score', 'session')[0].value).toBe(0);
  });
  it('fills missed weeks with zero activity and uses daily bars for the Week view', () => {
    const selected = [record('one', '2026-10-03T10:00:00Z'), record('two', '2026-10-24T10:00:00Z')];
    const bars = chartValues(selected, 'sessions', 'month', new Date('2026-10-29'), new Date('2026-10-29'));
    expect(bars.reduce((sum, bar) => sum + bar.value, 0)).toBe(2);
    expect(bars.some(bar => bar.value === 0)).toBe(true);
    const week = chartValues([selected[0]], 'sessions', 'week', new Date('2026-10-03'), new Date('2026-10-29'));
    expect(week).toHaveLength(7);
  });
});
