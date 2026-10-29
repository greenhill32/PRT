// Seeded PRNG (xorshift64)
class SeededRandom {
    constructor(seed) {
        Object.defineProperty(this, "state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.state = BigInt(seed) || 1n;
    }
    next() {
        let x = this.state;
        x = x ^ (x << 13n);
        x = x ^ (x >> 7n);
        x = x ^ (x << 17n);
        this.state = x;
        return Math.abs(Number(x % 1000000n)) / 1000000;
    }
}
const personas = {
    peer: { ability_offset: 1.0, form_variance: 0.1, noise_variance: 0.1 },
    steady: { ability_offset: 1.0, form_variance: 0.05, noise_variance: 0.05 },
    volatile: { ability_offset: 1.0, form_variance: 0.2, noise_variance: 0.2 },
    rival: { ability_offset: 1.35, form_variance: 0.1, noise_variance: 0.1 }
};
// Default baseline for cold start (< 3 prior sessions)
function defaultBaseline() {
    return {
        pushups_median: 30, // ~score 65
        plank_median_sec: 90, // 1:30, ~score 65
        row_median_sec: 570 // 9:30, ~score 60
    };
}
// Calculate median from sorted array
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
// Generate baseline from prior sessions
export function generateBaseline(priorSessions) {
    if (priorSessions.length < 3) {
        return defaultBaseline();
    }
    // For each event type, get the last 3-5 completed sessions and calculate median
    const pushups = [];
    const plank = [];
    const row = [];
    for (const session of priorSessions.slice(0, 5)) {
        // Reconstruct event results from ledger (simplified - in real app, query events table)
        // For now, assume we have cached results
        if (session.last_pushups)
            pushups.push(session.last_pushups);
        if (session.last_plank)
            plank.push(session.last_plank);
        if (session.last_row)
            row.push(session.last_row);
    }
    return {
        pushups_median: median(pushups) || defaultBaseline().pushups_median,
        plank_median_sec: median(plank) || defaultBaseline().plank_median_sec,
        row_median_sec: median(row) || defaultBaseline().row_median_sec
    };
}
// Bound push-ups at a reasonable max
function boundPushups(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
// Log-normal distribution for times (right-skewed, positive)
function logNormalValue(mean, form, noise) {
    // Approximate log-normal using exponential transformation
    const mu = Math.log(mean);
    const z = form + noise; // Combined effect
    const value = Math.exp(mu + z * 0.1); // 0.1 scales the effect
    return Math.max(0, value);
}
export function generateCompetitors(baseline, seed, ghostYouResults) {
    const competitors = {};
    for (const [name, persona] of Object.entries(personas)) {
        const prng = new SeededRandom(seed + name.charCodeAt(0));
        // Draw session form (good/bad day multiplier)
        const form = (prng.next() - 0.5) * 2 * persona.form_variance;
        // Generate results for each event
        const pushups_base = baseline.pushups_median * persona.ability_offset;
        const plank_base = baseline.plank_median_sec * persona.ability_offset;
        const row_base = baseline.row_median_sec * persona.ability_offset;
        // Push-ups: bounded count, use linear adjustment
        const pushups_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
        const pushups_adj = pushups_base * (1 + form * 0.5 + pushups_noise * 0.5);
        const pushups = boundPushups(pushups_adj);
        // Plank & Row: use log-normal for right-skewed distribution
        const plank_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
        const plank_adj = logNormalValue(plank_base, form * 0.5, plank_noise * 0.5);
        const plank = Math.max(30, Math.round(plank_adj)); // minimum 30 sec
        const row_noise = (prng.next() - 0.5) * 2 * persona.noise_variance;
        const row_adj = logNormalValue(row_base, form * 0.5, row_noise * 0.5);
        const row = Math.max(400, Math.round(row_adj)); // minimum 400 sec (6:40)
        competitors[name] = {
            pushups,
            plank,
            row_2k: row
        };
    }
    // Ghost You: best prior session or PB
    if (ghostYouResults) {
        competitors.ghost_you = ghostYouResults;
    }
    else {
        competitors.ghost_you = null;
    }
    return competitors;
}
// Rival must be beatable: ensure it's not too far ahead
export function ensureRivalBeatable(baseline, rival, maxPercentageAhead = 40) {
    return {
        pushups: Math.min(rival.pushups, Math.round(baseline.pushups_median * (1 + maxPercentageAhead / 100))),
        plank: Math.min(rival.plank, Math.round(baseline.plank_median_sec * (1 - maxPercentageAhead / 100))),
        row_2k: Math.min(rival.row_2k, Math.round(baseline.row_median_sec * (1 - maxPercentageAhead / 100)))
    };
}
