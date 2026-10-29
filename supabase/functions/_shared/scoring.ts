// Scoring module - single source of truth for PRT point calculation
// Used by both client (instant feedback) and Edge Function (authoritative)

export interface Threshold {
  rawValue: number;
  score: number;
}

export interface ScoringContext {
  version: string;
  thresholds: {
    pushups: Threshold[];
    plank: Threshold[];
    row2k: Threshold[];
  };
  categories: { min: number; max: number; label: string }[];
}

export type EventType = 'pushups' | 'plank' | 'row_2k';

export interface EventResults {
  pushups?: number;
  plank?: number;
  row_2k?: number;
}

export interface TierInfo {
  category: string;
  score: number;
  pointsToNext: number;
  nextCategory?: string;
}

// Personal app benchmarks inspired by Navy PRT 55-59 male thresholds.
export const navyScoring1_0: ScoringContext = {
  version: '1.0',
  thresholds: {
    pushups: [
      { rawValue: 16, score: 60 },
      { rawValue: 32, score: 65 },
      { rawValue: 38, score: 70 },
      { rawValue: 46, score: 75 },
      { rawValue: 48, score: 80 },
      { rawValue: 52, score: 85 },
      { rawValue: 56, score: 90 },
      { rawValue: 59, score: 95 },
      { rawValue: 60, score: 100 }
    ],
    plank: [
      { rawValue: 87, score: 60 },    // 1:27
      { rawValue: 104, score: 65 },   // 1:44
      { rawValue: 122, score: 70 },   // 2:02
      { rawValue: 139, score: 75 },   // 2:19
      { rawValue: 148, score: 80 },   // 2:28
      { rawValue: 156, score: 85 },   // 2:36
      { rawValue: 165, score: 90 },   // 2:45
      { rawValue: 169, score: 95 },   // 2:49
      { rawValue: 174, score: 100 }   // 2:54
    ],
    row2k: [
      { rawValue: 570, score: 60 },   // 9:30
      { rawValue: 550, score: 65 },   // 9:10
      { rawValue: 530, score: 70 },   // 8:50
      { rawValue: 510, score: 75 },   // 8:30
      { rawValue: 500, score: 80 },   // 8:20
      { rawValue: 490, score: 85 },   // 8:10
      { rawValue: 480, score: 90 },   // 8:00
      { rawValue: 470, score: 95 },   // 7:50
      { rawValue: 460, score: 100 }   // 7:40
    ]
  },
  categories: [
    { min: 0, max: 59, label: 'Does Not Meet Standards' },
    { min: 60, max: 69, label: 'Satisfactory' },
    { min: 70, max: 84, label: 'Good' },
    { min: 85, max: 99, label: 'Excellent' },
    { min: 100, max: 100, label: 'Outstanding' }
  ]
};

export const scoringVersions: Record<string, ScoringContext> = {
  '1.0': navyScoring1_0
};

// Interpolate between thresholds linearly, including below-minimum values
function interpolateScore(
  rawValue: number,
  thresholds: Threshold[],
  isAscending: boolean // push-ups/plank: higher is better; row: lower is better
): number {
  const minThreshold = thresholds[0];
  const maxThreshold = thresholds[thresholds.length - 1];

  // Handle above maximum
  if (isAscending) {
    if (rawValue >= maxThreshold.rawValue) return 100;
  } else {
    if (rawValue <= maxThreshold.rawValue) return 100;
  }

  // Handle between thresholds (normal case)
  for (let i = 0; i < thresholds.length - 1; i++) {
    const lower = thresholds[i];
    const upper = thresholds[i + 1];

    const inRange = isAscending
      ? rawValue >= lower.rawValue && rawValue <= upper.rawValue
      : rawValue <= lower.rawValue && rawValue >= upper.rawValue;

    if (inRange) {
      // Linear interpolation between two thresholds
      const rawRange = isAscending
        ? upper.rawValue - lower.rawValue
        : lower.rawValue - upper.rawValue;
      const scoreRange = upper.score - lower.score;
      const rawOffset = isAscending
        ? rawValue - lower.rawValue
        : lower.rawValue - rawValue;

      const t = rawRange > 0 ? rawOffset / rawRange : 0;
      return Math.round(lower.score + t * scoreRange);
    }
  }

  // Handle below minimum: interpolate from 0 at a sensible "worst" value
  // For push-ups: 0 reps → 0 points, 16 reps → 60 points
  // For times: very long time → 0 points, 1:27 (87 sec) plank → 60 points
  if (isAscending) {
    // Push-ups: extrapolate from 0 reps = 0 points to minThreshold
    const worstValue = 0;
    const worstScore = 0;
    const rawRange = minThreshold.rawValue - worstValue;
    const scoreRange = minThreshold.score - worstScore;
    const rawOffset = rawValue - worstValue;
    const t = rawRange > 0 ? rawOffset / rawRange : 0;
    return Math.max(0, Math.round(worstScore + t * scoreRange));
  } else {
    // Times: extrapolate from very long time = 0 points to minThreshold
    // Use 2x the minimum as "0 score" (reasonable worst case)
    const worstValue = minThreshold.rawValue * 2;
    const worstScore = 0;
    const rawRange = minThreshold.rawValue - worstValue;
    const scoreRange = minThreshold.score - worstScore;
    const rawOffset = rawValue - worstValue;
    const t = rawRange !== 0 ? rawOffset / rawRange : 0;
    return Math.max(0, Math.round(worstScore + t * scoreRange));
  }
}

export function eventPoints(
  eventType: EventType,
  rawValue: number,
  context: ScoringContext
): number {
  if (!Number.isFinite(rawValue) || rawValue < 0 || (eventType === 'row_2k' && rawValue === 0)) {
    return 0;
  }
  const thresholds =
    eventType === 'pushups'
      ? context.thresholds.pushups
      : eventType === 'plank'
        ? context.thresholds.plank
        : context.thresholds.row2k;

  const isAscending = eventType === 'pushups' || eventType === 'plank';
  const score = interpolateScore(rawValue, thresholds, isAscending);

  return Math.min(100, Math.max(0, score));
}

export function composite(
  results: EventResults | any,
  context: ScoringContext
): number {
  const scores: number[] = [];

  if (results.pushups !== undefined) {
    scores.push(eventPoints('pushups', results.pushups, context));
  }
  if (results.plank !== undefined) {
    scores.push(eventPoints('plank', results.plank, context));
  }
  if (results.row_2k !== undefined) {
    scores.push(eventPoints('row_2k', results.row_2k, context));
  }

  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function tierOf(
  score: number,
  context: ScoringContext
): TierInfo {
  const category = context.categories.find(
    (c) => score >= c.min && score <= c.max
  );

  if (!category) {
    return {
      category: 'Unknown',
      score,
      pointsToNext: 0
    };
  }

  // Find the next tier (first category with min > current category's max)
  const nextCategory = context.categories.find((c) => c.min > category.max);
  const pointsToNext = nextCategory ? nextCategory.min - score : 0;

  return {
    category: category.label,
    score,
    pointsToNext,
    nextCategory: nextCategory?.label
  };
}

export function gapToNextTier(
  score: number,
  eventType: EventType,
  context: ScoringContext
): { pointGap: number; rawValueNeeded: number } {
  const tier = tierOf(score, context);
  if (!tier.nextCategory) {
    return { pointGap: 0, rawValueNeeded: 0 };
  }

  const pointGap = tier.pointsToNext;
  const targetScore = score + pointGap;

  // Binary search to find the raw value needed to achieve targetScore
  const thresholds =
    eventType === 'pushups'
      ? context.thresholds.pushups
      : eventType === 'plank'
        ? context.thresholds.plank
        : context.thresholds.row2k;

  const isAscending = eventType === 'pushups' || eventType === 'plank';

  // Find min and max raw values to search
  const minRaw = thresholds[0].rawValue;
  const maxRaw = thresholds[thresholds.length - 1].rawValue;

  let low = isAscending ? minRaw : maxRaw;
  let high = isAscending ? maxRaw : minRaw;
  let best = isAscending ? maxRaw : minRaw;

  // Binary search for raw value that gives targetScore
  for (let i = 0; i < 20; i++) {
    const mid = isAscending ? (low + high) / 2 : (low + high) / 2;
    const midScore = eventPoints(eventType, mid, context);

    if (Math.abs(midScore - targetScore) < 1) {
      best = mid;
      break;
    }

    if (midScore < targetScore) {
      if (isAscending) {
        low = mid;
      } else {
        high = mid;
      }
    } else {
      if (isAscending) {
        high = mid;
      } else {
        low = mid;
      }
    }

    best = mid;
  }

  return {
    pointGap,
    rawValueNeeded: Math.round(best)
  };
}

