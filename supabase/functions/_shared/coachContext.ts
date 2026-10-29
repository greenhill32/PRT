import { computeEffectiveResults, buildLeaderboard, computeEffectiveRawResults } from './leaderboard.ts';
import { scoringVersions, composite, tierOf } from './scoring.ts';
import type { Session, Event } from './types.ts';

export function buildCoachContext(session: Session, events: Event[]) {
  const context = scoringVersions[session.scoring_version];
  if (!context) throw new Error('Unsupported scoring version');
  const confirmed_results = computeEffectiveResults(events, context);
  const raw = computeEffectiveRawResults(events);
  const provisional_score = composite(raw, context);
  const tier = tierOf(provisional_score, context);
  const revealed = new Set(Object.keys(raw));
  const leaderboard = buildLeaderboard(confirmed_results,
    session.kind === 'saturday_prt' ? session.competitor_snapshot : {} as Session['competitor_snapshot'],
    revealed, context);
  return { confirmed_results, provisional_score, category: tier.category,
    points_to_next_tier: tier.pointsToNext, leaderboard };
}
