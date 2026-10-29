import type { BaselineSnapshot, CompetitorSnapshot, CompetitorResults } from './types';

export const COMPETITOR_MODEL_VERSION = '2.0';

// Fixed-width xorshift32: reproducible without unbounded BigInt state.
class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 1; }
  next(): number {
    let x = this.state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0;
    return (this.state + 0.5) / 4294967296;
  }
  normal(): number {
    return Math.sqrt(-2 * Math.log(this.next())) * Math.cos(2 * Math.PI * this.next());
  }
}

function nameSeed(seed: number, name: string): number {
  let hash = seed >>> 0;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

const personas = {
  peer: { abilitySD: 0, formSD: 0.65, noiseSD: 0.75 },
  steady: { abilitySD: 0, formSD: 0.35, noiseSD: 0.4 },
  volatile: { abilitySD: 0, formSD: 0.9, noiseSD: 1.2 },
  rival: { abilitySD: 0.4, formSD: 0.65, noiseSD: 0.75 }
};

const defaultBaseline = (): BaselineSnapshot => ({
  pushups_median: 30, plank_median_sec: 90, row_median_sec: 570
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function generateBaseline(
  priorResults: Array<{ pushups?: number; plank?: number; row_2k?: number }>
): BaselineSnapshot {
  const fallback = defaultBaseline();
  const values = (type: 'pushups' | 'plank' | 'row_2k') => priorResults.slice(0, 5)
    .map(r => r[type]).filter((v): v is number => Number.isFinite(v) && v >= 0 && (type !== 'row_2k' || v > 0));
  const pushups = values('pushups'), plank = values('plank'), row = values('row_2k');
  return {
    pushups_median: pushups.length ? median(pushups) : fallback.pushups_median,
    plank_median_sec: plank.length ? median(plank) : fallback.plank_median_sec,
    row_median_sec: row.length ? median(row) : fallback.row_median_sec
  };
}

export function generateCompetitors(
  baseline: BaselineSnapshot,
  seed: number,
  ghostYouResults?: CompetitorResults
): CompetitorSnapshot {
  const competitors: Partial<CompetitorSnapshot> = {};
  for (const [name, persona] of Object.entries(personas)) {
    const rng = new SeededRandom(nameSeed(seed, name));
    const form = rng.normal() * persona.formSD;
    const performance = () => persona.abilitySD + form + rng.normal() * persona.noiseSD;
    // Positive performance improves every event: more reps, longer plank, faster row.
    // Rival's advantage is 0.4 SD, with overlapping good/bad day distributions.
    const result: CompetitorResults = {
      pushups: Math.max(0, Math.round(baseline.pushups_median * (1 + 0.12 * performance()))),
      plank: Math.max(0, Math.round(baseline.plank_median_sec * Math.exp(0.12 * performance()))),
      row_2k: Math.max(1, Math.round(baseline.row_median_sec * Math.exp(-0.05 * performance())))
    };
    competitors[name] = result;
  }
  competitors.ghost_you = ghostYouResults ? { ...ghostYouResults } : null;
  return competitors as CompetitorSnapshot;
}

// Optional hard bound; generation itself uses overlapping performance distributions.
export function ensureRivalBeatable(
  baseline: BaselineSnapshot, rival: CompetitorResults, maxPercentageAhead = 40
): CompetitorResults {
  const fraction = Math.max(0, Math.min(99, maxPercentageAhead)) / 100;
  return {
    pushups: Math.min(rival.pushups, Math.round(baseline.pushups_median * (1 + fraction))),
    plank: Math.min(rival.plank, Math.round(baseline.plank_median_sec * (1 + fraction))),
    row_2k: Math.max(rival.row_2k, Math.round(baseline.row_median_sec * (1 - fraction)))
  };
}
