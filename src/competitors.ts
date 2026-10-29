// Competitor generation with seeded deterministic PRNG
import type { BaselineSnapshot, CompetitorSnapshot, CompetitorResults } from './types';

// Seeded PRNG (xorshift64)
class SeededRandom {
  private state: bigint;

  constructor(seed: number) {
    this.state = BigInt(seed) || 1n;
  }

  next(): number {
    let x = this.state;
    x = x ^ (x << 13n);
    x = x ^ (x >> 7n);
    x = x ^ (x << 17n);
    this.state = x;
    return Math.abs(Number(x % 1000000n)) / 1000000;
  }
}

interface Persona {
  ability_offset: number; // multiplier
  form_variance: number;  // ±
  noise_variance: number; // ±
}

const personas: Record<string, Persona> = {
  peer: { ability_offset: 1.0, form_variance: 0.1, noise_variance: 0.1 },
  steady: { ability_offset: 1.0, form_variance: 0.05, noise_variance: 0.05 },
  volatile: { ability_offset: 1.0, form_variance: 0.2, noise_variance: 0.2 },
  rival: { ability_offset: 1.35, form_variance: 0.1, noise_variance: 0.1 }
};

// Default baseline for cold start (< 3 prior sessions)
function defaultBaseline(): BaselineSnapshot {
  return {
    pushups_median: 30,  // ~score 65
    plank_median_sec: 90, // 1:30, ~score 65
    row_median_sec: 570  // 9:30, ~score 60
  };
}

// Calculate median from sorted array
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Generate baseline from effective results of prior sessions
export function generateBaseline(
  priorResults: Array<{ pushups?: number; plank?: number; row_2k?: number }>
): BaselineSnapshot {
  if (priorResults.length === 0) {
    return defaultBaseline();
  }

  // For each event type, collect values from prior sessions and calculate median
  const pushups = [];
  const plank = [];
  const row = [];

  for (const result of priorResults) {
    if (result.pushups !== undefined && result.pushups > 0) pushups.push(result.pushups);
    if (result.plank !== undefined && result.plank > 0) plank.push(result.plank);
    if (result.row_2k !== undefined && result.row_2k > 0) row.push(result.row_2k);
  }

  return {
    pushups_median: pushups.length > 0 ? median(pushups) : defaultBaseline().pushups_median,
    plank_median_sec: plank.length > 0 ? median(plank) : defaultBaseline().plank_median_sec,
    row_median_sec: row.length > 0 ? median(row) : defaultBaseline().row_median_sec
  };
}

// Bound push-ups at a reasonable max
function boundPushups(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Log-normal distribution for times (right-skewed, positive)
function logNormalValue(mean: number, form: number, noise: number): number {
  // Approximate log-normal using exponential transformation
  const mu = Math.log(mean);
  const z = form + noise; // Combined effect
  const value = Math.exp(mu + z * 0.1); // 0.1 scales the effect
  return Math.max(0, value);
}

export function generateCompetitors(
  baseline: BaselineSnapshot,
  seed: number,
  ghostYouResults?: { pushups: number; plank: number; row_2k: number }
): CompetitorSnapshot {
  const competitors: any = {};

  for (const [name, persona] of Object.entries(personas)) {
    const prng = new SeededRandom(seed + name.charCodeAt(0));

    // Draw session form (good/bad day multiplier)
    const form = (prng.next() - 0.5) * 2 * persona.form_variance;

    // Generate results for each event
    // For push-ups (more is better): multiply upward
    const pushups_base = baseline.pushups_median * persona.ability_offset;

    // For times (less is better): invert the multiplier
    // ability_offset > 1 means stronger, which means lower time
    const ability_inverse = 1 / persona.ability_offset;
    const plank_base = baseline.plank_median_sec * ability_inverse;
    const row_base = baseline.row_median_sec * ability_inverse;

    // Push-ups: bounded count, use linear adjustment
    const pushups_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
    const pushups_adj = pushups_base * (1 + form * 0.5 + pushups_noise * 0.5);
    const pushups: number = boundPushups(pushups_adj);

    // Plank & Row: use log-normal for right-skewed distribution
    const plank_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
    const plank_adj = logNormalValue(
      plank_base,
      form * 0.5,
      plank_noise * 0.5
    );
    const plank: number = Math.max(30, Math.round(plank_adj)); // minimum 30 sec

    const row_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
    const row_adj = logNormalValue(
      row_base,
      form * 0.5,
      row_noise * 0.5
    );
    const row: number = Math.max(400, Math.round(row_adj)); // minimum 400 sec (6:40)

    competitors[name] = {
      pushups,
      plank,
      row_2k: row
    };
  }

  // Ghost You: best prior session or PB
  if (ghostYouResults) {
    competitors.ghost_you = ghostYouResults;
  } else {
    competitors.ghost_you = null;
  }

  return competitors as CompetitorSnapshot;
}

// Rival must be beatable: ensure it's not too far ahead
export function ensureRivalBeatable(
  baseline: BaselineSnapshot,
  rival: CompetitorResults,
  maxPercentageAhead: number = 40
): CompetitorResults {
  return {
    pushups: Math.min(
      rival.pushups,
      Math.round(baseline.pushups_median * (1 + maxPercentageAhead / 100))
    ),
    plank: Math.min(
      rival.plank,
      Math.round(baseline.plank_median_sec * (1 - maxPercentageAhead / 100))
    ),
    row_2k: Math.min(
      rival.row_2k,
      Math.round(baseline.row_median_sec * (1 - maxPercentageAhead / 100))
    )
  };
}
