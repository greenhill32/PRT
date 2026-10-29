import { computeEffectiveRawResults } from './leaderboard';
import { composite, scoringVersions } from './scoring';
import type { Event, Session, CompetitorResults } from './types';

export const PROGRESS_TIME_ZONE = 'Europe/London';
export const PERIODS = ['session', 'week', 'month', 'year', 'all'] as const;
export type ProgressPeriod = typeof PERIODS[number];
export type ProgressMetric = 'score' | 'pushups' | 'plank' | 'row_2k' | 'sessions';
export const CORE_COMPETITORS = ['you', 'peer', 'steady', 'volatile', 'rival'] as const;
export type CompetitorKey = typeof CORE_COMPETITORS[number];
export const COMPETITOR_NAMES: Record<CompetitorKey, string> = {
  you: 'You', peer: 'Peer', steady: 'Steady', volatile: 'Volatile', rival: 'Rival'
};
export interface ProgressRecord {
  session: Session; date: string; results: Partial<CompetitorResults>;
  score: number | null; issue: 'incomplete' | 'unsupported' | 'invalid' | null;
}
export interface LeagueRow {
  key: CompetitorKey; name: string; rank: number; played: number; wins: number;
  points: number; averageScore: number | null;
}
type CalendarDate = { year: number; month: number; day: number };
function calendarDate(date: Date, timeZone = PROGRESS_TIME_ZONE): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const value = (name: string) => Number(parts.find(part => part.type === name)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}
function normalise(date: CalendarDate): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}
function midnight(date: CalendarDate, timeZone = PROGRESS_TIME_ZONE): number {
  const wanted = Date.UTC(date.year, date.month - 1, date.day);
  let instant = wanted;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
    }).formatToParts(new Date(instant));
    const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    instant += wanted - wall;
  }
  return instant;
}
export function periodBounds(period: ProgressPeriod, anchor: Date, timeZone = PROGRESS_TIME_ZONE) {
  if (period === 'all' || period === 'session') return null;
  let start = calendarDate(anchor, timeZone);
  let end: CalendarDate;
  if (period === 'week') {
    const weekday = new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay();
    start = normalise({ ...start, day: start.day - (weekday + 6) % 7 });
    end = normalise({ ...start, day: start.day + 7 });
  } else if (period === 'month') {
    start.day = 1;
    end = normalise({ ...start, month: start.month + 1 });
  } else {
    start = { year: start.year, month: 1, day: 1 };
    end = { ...start, year: start.year + 1 };
  }
  return { start: midnight(start, timeZone), end: midnight(end, timeZone) };
}
export function shiftPeriod(anchor: Date, period: ProgressPeriod, amount: number): Date {
  const current = calendarDate(anchor);
  if (period === 'week') current.day += 7 * amount;
  if (period === 'month') { current.month += amount; current.day = 1; }
  if (period === 'year') { current.year += amount; current.month = 1; current.day = 1; }
  const date = normalise(current);
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}
export function periodLabel(period: ProgressPeriod, anchor: Date): string {
  if (period === 'all') return 'Your complete history';
  if (period === 'session') return 'Session results';
  const bounds = periodBounds(period, anchor)!;
  const format = (date: number, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: PROGRESS_TIME_ZONE, ...options }).format(date);
  if (period === 'year') return format(bounds.start, { year: 'numeric' });
  if (period === 'month') return format(bounds.start, { month: 'long', year: 'numeric' });
  return format(bounds.start, { day: 'numeric', month: 'short' }) + ' – ' +
    format(bounds.end - 1, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const formatSessionDate = (date: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: PROGRESS_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric'
}).format(new Date(date));
export function formatTime(seconds: number | null): string {
  if (seconds === null) return '—';
  const rounded = Math.round(seconds);
  return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0');
}
export function createProgressRecords(sessions: Session[], events: Event[]): ProgressRecord[] {
  const grouped = new Map<string, Event[]>();
  for (const event of events) {
    if (!grouped.has(event.session_id)) grouped.set(event.session_id, []);
    grouped.get(event.session_id)!.push(event);
  }
  return sessions.filter(session => session.state === 'completed' && Number.isFinite(Date.parse(session.started_at))).map(session => {
    const raw = computeEffectiveRawResults(grouped.get(session.session_id) ?? []);
    const invalid = Object.entries(raw).some(([type, value]) =>
      !Number.isSafeInteger(value) || value < 0 || (type === 'row_2k' && value <= 0));
    const context = scoringVersions[session.scoring_version];
    const results = Object.fromEntries(Object.entries(raw).filter(([type, value]) =>
      Number.isSafeInteger(value) && value >= 0 && (type !== 'row_2k' || value > 0)));
    const incomplete = ['pushups', 'plank', 'row_2k'].some(type => results[type] === undefined);
    const issue: ProgressRecord['issue'] = invalid ? 'invalid' : !context ? 'unsupported' : incomplete ? 'incomplete' : null;
    return { session, date: session.started_at, results,
      score: issue ? null : composite(results, context), issue };
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.session.session_id.localeCompare(b.session.session_id));
}
export function selectProgressRecords(records: ProgressRecord[], period: ProgressPeriod, anchor: Date,
  includePractice = false, sessionId?: string): ProgressRecord[] {
  if (period === 'session') return records.filter(record => record.session.session_id === sessionId);
  const bounds = periodBounds(period, anchor);
  return records.filter(record => (includePractice || record.session.kind === 'saturday_prt') &&
    (!bounds || (Date.parse(record.date) >= bounds.start && Date.parse(record.date) < bounds.end)));
}
const mean = (values: number[]): number | null => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export function eventStatistics(records: ProgressRecord[], previous: ProgressRecord[]) {
  return (['pushups', 'plank', 'row_2k'] as const).map(type => {
    const values = records.map(record => record.results[type]).filter((v): v is number => v !== undefined);
    const prior = previous.map(record => record.results[type]).filter((v): v is number => v !== undefined);
    const average = mean(values), priorAverage = mean(prior);
    return {
      type, count: values.length, latest: values.length ? values[values.length - 1] : null,
      average, best: values.length ? (type === 'row_2k' ? Math.min(...values) : Math.max(...values)) : null,
      improvement: average !== null && priorAverage !== null
        ? (type === 'row_2k' ? priorAverage - average : average - priorAverage) : null
    };
  });
}
function validOpponent(value: CompetitorResults | undefined): value is CompetitorResults {
  return !!value && Number.isSafeInteger(value.pushups) && value.pushups >= 0
    && Number.isSafeInteger(value.plank) && value.plank >= 0
    && Number.isSafeInteger(value.row_2k) && value.row_2k > 0;
}
export function buildLeague(records: ProgressRecord[]): { rows: LeagueRow[]; counted: number; skipped: number } {
  const rows: LeagueRow[] = CORE_COMPETITORS.map(key => ({
    key, name: COMPETITOR_NAMES[key], rank: 0, played: 0, wins: 0, points: 0, averageScore: null
  }));
  const scores = new Map<CompetitorKey, number[]>(CORE_COMPETITORS.map(key => [key, []]));
  let counted = 0, skipped = 0;
  for (const record of records.filter(record => record.session.kind === 'saturday_prt')) {
    const context = scoringVersions[record.session.scoring_version];
    const snapshot = record.session.competitor_snapshot;
    if (record.score === null || !context || !snapshot ||
      !CORE_COMPETITORS.filter(key => key !== 'you').every(key => validOpponent(snapshot[key]))) { skipped++; continue; }
    const finishers = rows.map(row => ({ row,
      score: row.key === 'you' ? record.score! : composite(snapshot[row.key], context)
    })).sort((a, b) => b.score - a.score);
    for (let start = 0; start < finishers.length;) {
      let end = start + 1;
      while (end < finishers.length && finishers[end].score === finishers[start].score) end++;
      // Share the points for occupied places: tied 1st/2nd => (5 + 4) / 2.
      const points = Array.from({ length: end - start }, (_, i) => 5 - start - i)
        .reduce((sum, value) => sum + value, 0) / (end - start);
      for (const finisher of finishers.slice(start, end)) {
        finisher.row.points += points; finisher.row.played++;
        finisher.row.wins += start === 0 ? 1 : 0;
        scores.get(finisher.row.key)!.push(finisher.score);
      }
      start = end;
    }
    counted++;
  }
  rows.sort((a, b) => b.points - a.points);
  rows.forEach((row, index) => {
    row.rank = index && row.points === rows[index - 1].points ? rows[index - 1].rank : index + 1;
    row.averageScore = mean(scores.get(row.key)!);
  });
  return { rows: counted ? rows : [], counted, skipped };
}
export function progressSummary(records: ProgressRecord[], previous: ProgressRecord[]) {
  const scored = records.filter(record => record.score !== null);
  const average = mean(scored.map(record => record.score!));
  const priorAverage = mean(previous.filter(record => record.score !== null).map(record => record.score!));
  return {
    count: records.length, scoredCount: scored.length, average,
    best: scored.length ? Math.max(...scored.map(record => record.score!)) : null,
    change: average !== null && priorAverage !== null ? average - priorAverage : null,
    recordedPushups: records.reduce((total, record) => total + (record.results.pushups ?? 0), 0),
    recordedPlankSeconds: records.reduce((total, record) => total + (record.results.plank ?? 0), 0),
    rowDistanceKm: records.filter(record => record.results.row_2k !== undefined).length * 2
  };
}
export function previousRecords(records: ProgressRecord[], selected: ProgressRecord[], period: ProgressPeriod,
  anchor: Date, includePractice: boolean): ProgressRecord[] {
  if (period === 'all') return [];
  if (period !== 'session') return selectProgressRecords(records, period, shiftPeriod(anchor, period, -1), includePractice);
  const current = selected[0];
  if (!current) return [];
  const index = records.findIndex(record => record.session.session_id === current.session.session_id);
  return records.slice(0, index).filter(record => record.session.kind === current.session.kind).slice(-1);
}
export function sessionFinish(record: ProgressRecord | undefined) {
  if (!record || record.score === null || record.session.kind !== 'saturday_prt') return null;
  const context = scoringVersions[record.session.scoring_version];
  const values = [record.score, ...['peer', 'steady', 'volatile', 'rival', 'ghost_you'].flatMap(key => {
    const value = record.session.competitor_snapshot?.[key];
    return validOpponent(value) ? [composite(value, context)] : [];
  })];
  return { rank: 1 + values.filter(score => score > record.score!).length, total: values.length,
    tied: values.filter(score => score === record.score).length > 1 };
}
export function chartValues(records: ProgressRecord[], metric: ProgressMetric, period: ProgressPeriod,
  anchor = new Date(), now = new Date()) {
  if (metric !== 'sessions') return records.flatMap(record => {
    const value = metric === 'score' ? record.score : record.results[metric];
    return value === null || value === undefined ? [] : [{
      id: record.session.session_id, date: record.date, label: formatSessionDate(record.date), value
    }];
  });
  if (!records.length) return [];
  const groups = new Map<string, { id: string; date: string; label: string; value: number }>();
  const years = new Set(records.map(record => calendarDate(new Date(record.date)).year));
  const interval = period === 'week' || period === 'session' ? 'day'
    : period === 'month' ? 'week' : period === 'all' && years.size > 2 ? 'year' : 'month';
  const bucket = (date: Date) => {
    const parts = calendarDate(date);
    if (interval === 'week') return periodBounds('week', date)!.start;
    return midnight({ year: parts.year, month: interval === 'year' ? 1 : parts.month,
      day: interval === 'day' ? parts.day : 1 });
  };
  const label = (date: number) => new Intl.DateTimeFormat('en-GB', {
    timeZone: PROGRESS_TIME_ZONE,
    ...(interval === 'year' ? { year: 'numeric' as const } : interval === 'month'
      ? { month: 'short' as const, year: 'numeric' as const }
      : { day: 'numeric' as const, month: 'short' as const })
  }).format(date);
  const setBucket = (date: number, value = 0) => {
    const id = String(date);
    groups.set(id, { id, date: new Date(date).toISOString(), label: label(date), value });
  };
  for (const record of records) {
    const date = bucket(new Date(record.date)), id = String(date);
    setBucket(date, (groups.get(id)?.value ?? 0) + 1);
  }
  const bounds = periodBounds(period, anchor);
  const first = bounds ? bucket(new Date(bounds.start)) : Math.min(...records.map(record => bucket(new Date(record.date))));
  const last = bounds ? Math.min(bounds.end - 1, now.getTime())
    : Math.max(...records.map(record => bucket(new Date(record.date))));
  // Include empty calendar buckets so a missed week is visible, not compressed away.
  for (let cursor = first; cursor <= last;) {
    if (!groups.has(String(cursor))) setBucket(cursor);
    const next = calendarDate(new Date(cursor));
    if (interval === 'day') next.day++;
    if (interval === 'week') next.day += 7;
    if (interval === 'month') next.month++;
    if (interval === 'year') next.year++;
    cursor = midnight(normalise(next));
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}
