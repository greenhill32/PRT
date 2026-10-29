// Leaderboard calculation - recomputes from the ledger
import { eventPoints, composite, navyScoring1_0 } from './scoring';
const ctx = navyScoring1_0;
// Compute effective results from append-only ledger
export function computeEffectiveResults(events) {
    const results = {};
    const eventTypes = ['pushups', 'plank', 'row_2k'];
    for (const eventType of eventTypes) {
        // Get all non-void events of this type, sorted latest first
        const relevant = events
            .filter((e) => e.event_type === eventType && e.event_type !== 'void')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        // Find the latest non-voided event
        for (const evt of relevant) {
            const isVoided = events.some((e) => e.voids_event_id === evt.event_id);
            if (!isVoided && evt.raw_value !== null) {
                const points = eventPoints(eventType, evt.raw_value, ctx);
                results[eventType] = {
                    raw_value: evt.raw_value,
                    points
                };
                break;
            }
        }
    }
    return results;
}
// Build leaderboard from user results and competitors
export function buildLeaderboard(userResults, competitors, revealedEvents) {
    const rows = [];
    // User row
    const userScore = composite({
        pushups: userResults.pushups?.raw_value,
        plank: userResults.plank?.raw_value,
        row_2k: userResults.row_2k?.raw_value
    }, ctx);
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
        const competitor = competitors[name];
        if (!competitor)
            continue;
        const row = {
            rank: 0,
            name: name === 'ghost_you' ? 'Ghost You' : capitalize(name),
            overall_score: 0
        };
        // Only include event data if that event is revealed
        if (revealedEvents.has('pushups')) {
            const points = eventPoints('pushups', competitor.pushups, ctx);
            row.pushups = competitor.pushups;
            row.pushups_score = points;
        }
        if (revealedEvents.has('plank')) {
            const points = eventPoints('plank', competitor.plank, ctx);
            row.plank = competitor.plank;
            row.plank_score = points;
        }
        if (revealedEvents.has('row_2k')) {
            const points = eventPoints('row_2k', competitor.row_2k, ctx);
            row.row_2k = competitor.row_2k;
            row.row_2k_score = points;
        }
        // Calculate overall score only from revealed events
        const revealedScores = [];
        if (revealedEvents.has('pushups') && row.pushups_score)
            revealedScores.push(row.pushups_score);
        if (revealedEvents.has('plank') && row.plank_score)
            revealedScores.push(row.plank_score);
        if (revealedEvents.has('row_2k') && row.row_2k_score)
            revealedScores.push(row.row_2k_score);
        if (revealedScores.length > 0) {
            row.overall_score = Math.round(revealedScores.reduce((a, b) => a + b, 0) / revealedScores.length);
        }
        rows.push(row);
    }
    // Sort by overall score (descending)
    rows.sort((a, b) => b.overall_score - a.overall_score);
    // Assign ranks
    rows.forEach((row, idx) => {
        row.rank = idx + 1;
    });
    return rows;
}
// Test: verify leaderboard can be recomputed from raw ledger
export function testLeaderboardReproducibility(events, competitors, revealedEvents) {
    const effectiveResults = computeEffectiveResults(events);
    const leaderboard = buildLeaderboard(effectiveResults, competitors, revealedEvents);
    const userRow = leaderboard.find((r) => r.name === 'You');
    const computedScore = composite({
        pushups: effectiveResults.pushups?.raw_value,
        plank: effectiveResults.plank?.raw_value,
        row_2k: effectiveResults.row_2k?.raw_value
    }, ctx);
    return {
        matches: userRow?.overall_score === computedScore,
        userScore: userRow?.overall_score || 0,
        computedScore
    };
}
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
