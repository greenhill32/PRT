// Leaderboard calculation - recomputes from the ledger
import { eventPoints, composite, tierOf, navyScoring1_0 } from './scoring.ts';
import type { Event, CompetitorSnapshot, LeaderboardRow } from './types.ts';

const ctx = navyScoring1_0;

export interface EventScores {
  pushups?: { raw_value: number; points: number };
  plank?: { raw_value: number; points: number };
  row_2k?: { raw_value: number; points: number };
}

// Compute effective results from append-only ledger
export function computeEffectiveRawResults(events: Event[]): { pushups?: number; plank?: number; row_2k?: number } {
  const results: any = {};
  const voided = new Set(events.filter(e => e.event_type === 'void').map(e => e.voids_event_id));
  const eventTypes = ['pushups', 'plank', 'row_2k'];

  for (const eventType of eventTypes) {
    // Get all non-void events of this type, sorted latest first
    const relevant = events
      .filter((e) => e.event_type === eventType && e.event_type !== 'void')
      .sort(
        (a, b) =>
          new Date(b.timestamp || b.created_at).getTime() - new Date(a.timestamp || a.created_at).getTime()
          || b.event_id.localeCompare(a.event_id)
      );

    // Find the latest non-voided event
    for (const evt of relevant) {
      const isVoided = voided.has(evt.event_id);
      if (!isVoided && evt.raw_value !== null && Number.isFinite(evt.raw_value)) {
        results[eventType] = evt.raw_value;
        break;
      }
    }
  }

  return results;
}

export function computeEffectiveResults(events: Event[], context = ctx): EventScores {
  return Object.fromEntries(Object.entries(computeEffectiveRawResults(events)).map(([type, raw_value]) => [
    type, { raw_value, points: eventPoints(type as 'pushups' | 'plank' | 'row_2k', raw_value, context) }
  ]));
}

// Build leaderboard from user results and competitors
export function buildLeaderboard(
  userResults: EventScores,
  competitors: CompetitorSnapshot,
  revealedEvents: Set<string>,
  context = ctx
): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];

  // User row
  const userScore = composite(
    {
      pushups: userResults.pushups?.raw_value,
      plank: userResults.plank?.raw_value,
      row_2k: userResults.row_2k?.raw_value
    },
    context
  );

  rows.push({
    rank: 0, // will recalculate
    name: 'You',
    pushups: userResults.pushups?.raw_value,
    pushups_score: userResults.pushups?.points,
    plank: userResults.plank?.raw_value,
    plank_score: userResults.plank?.points,
    row_2k: userResults.row_2k?.raw_value,
    row_2k_score: userResults.row_2k?.points,
    overall_score: userScore
  });

  // Competitor rows (only add revealed data)
  const competitorNames = ['peer', 'steady', 'volatile', 'rival', 'ghost_you'];

  for (const name of competitorNames) {
    const competitor = (competitors as any)[name];
    if (!competitor) continue;

    const row: LeaderboardRow = {
      rank: 0,
      name: name === 'ghost_you' ? 'Ghost You' : capitalize(name),
      overall_score: 0
    };

    // Only include event data if that event is revealed
    if (revealedEvents.has('pushups')) {
      const points = eventPoints('pushups', competitor.pushups, context);
      row.pushups = competitor.pushups;
      row.pushups_score = points;
    }

    if (revealedEvents.has('plank')) {
      const points = eventPoints('plank', competitor.plank, context);
      row.plank = competitor.plank;
      row.plank_score = points;
    }

    if (revealedEvents.has('row_2k')) {
      const points = eventPoints('row_2k', competitor.row_2k, context);
      row.row_2k = competitor.row_2k;
      row.row_2k_score = points;
    }

    // Calculate overall score only from revealed events
    const revealedScores = [];
    if (revealedEvents.has('pushups') && row.pushups_score !== undefined)
      revealedScores.push(row.pushups_score);
    if (revealedEvents.has('plank') && row.plank_score !== undefined)
      revealedScores.push(row.plank_score);
    if (revealedEvents.has('row_2k') && row.row_2k_score !== undefined)
      revealedScores.push(row.row_2k_score);

    if (revealedScores.length > 0) {
      row.overall_score = Math.round(
        revealedScores.reduce((a, b) => a + b, 0) / revealedScores.length
      );
    }

    rows.push(row);
  }

  // Sort by overall score (descending)
  rows.sort((a, b) => b.overall_score - a.overall_score);

  // Assign ranks
  rows.forEach((row, idx) => {
    row.rank = idx > 0 && row.overall_score === rows[idx - 1].overall_score ? rows[idx - 1].rank : idx + 1;
  });

  return rows;
}

// Test: verify leaderboard can be recomputed from raw ledger
export function testLeaderboardReproducibility(
  events: Event[],
  competitors: CompetitorSnapshot,
  revealedEvents: Set<string>
): { matches: boolean; userScore: number; computedScore: number } {
  const effectiveResults = computeEffectiveResults(events);
  const leaderboard = buildLeaderboard(effectiveResults, competitors, revealedEvents);
  const userRow = leaderboard.find((r) => r.name === 'You');

  const computedScore = composite(
    {
      pushups: effectiveResults.pushups?.raw_value,
      plank: effectiveResults.plank?.raw_value,
      row_2k: effectiveResults.row_2k?.raw_value
    },
    ctx
  );

  return {
    matches: userRow?.overall_score === computedScore,
    userScore: userRow?.overall_score || 0,
    computedScore
  };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

