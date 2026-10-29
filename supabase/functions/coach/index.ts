import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';

const supabase = createClient(supabaseUrl, supabaseServiceRole);

interface CoachRequest {
  session_id: string;
  question?: string;
}

interface CoachResponse {
  advice: string;
  session_id: string;
}

// Compute effective results from append-only ledger
async function getEffectiveResults(session_id: string, user_id: string) {
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const results: any = {};
  const eventTypes = ['pushups', 'plank', 'row_2k'];

  for (const eventType of eventTypes) {
    const relevant = (events || [])
      .filter((e: any) => e.event_type === eventType && e.event_type !== 'void')
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

    for (const evt of relevant) {
      const isVoided = (events || []).some((e: any) => e.voids_event_id === evt.event_id);
      if (!isVoided && evt.raw_value !== null) {
        results[eventType] = evt.raw_value;
        break;
      }
    }
  }

  return results;
}

// Compute event points (copied from client-side scoring module)
function eventPoints(
  eventType: string,
  rawValue: number
): number {
  const thresholds: Record<string, Array<[number, number]>> = {
    pushups: [
      [16, 60],
      [32, 65],
      [38, 70],
      [46, 75],
      [48, 80],
      [52, 85],
      [56, 90],
      [59, 95],
      [60, 100]
    ],
    plank: [
      [87, 60],
      [104, 65],
      [122, 70],
      [139, 75],
      [148, 80],
      [156, 85],
      [165, 90],
      [169, 95],
      [174, 100]
    ],
    row_2k: [
      [570, 60],
      [550, 65],
      [530, 70],
      [510, 75],
      [500, 80],
      [490, 85],
      [480, 90],
      [470, 95],
      [460, 100]
    ]
  };

  const t = thresholds[eventType] || [];
  const isAscending = eventType === 'pushups' || eventType === 'plank';

  // Handle above maximum
  if (isAscending) {
    if (rawValue >= t[t.length - 1][0]) return 100;
  } else {
    if (rawValue <= t[t.length - 1][0]) return 100;
  }

  // Find between thresholds (normal case)
  for (let i = 0; i < t.length - 1; i++) {
    const lower = t[i];
    const upper = t[i + 1];

    const inRange = isAscending
      ? rawValue >= lower[0] && rawValue <= upper[0]
      : rawValue <= lower[0] && rawValue >= upper[0];

    if (inRange) {
      const rawRange = isAscending
        ? upper[0] - lower[0]
        : lower[0] - upper[0];
      const scoreRange = upper[1] - lower[1];
      const rawOffset = isAscending
        ? rawValue - lower[0]
        : lower[0] - rawValue;

      const ratio = rawRange > 0 ? rawOffset / rawRange : 0;
      return Math.round(lower[1] + ratio * scoreRange);
    }
  }

  // Handle below minimum: interpolate from 0
  if (isAscending) {
    // Push-ups: extrapolate from 0 reps = 0 points
    const worstValue = 0;
    const worstScore = 0;
    const rawRange = t[0][0] - worstValue;
    const scoreRange = t[0][1] - worstScore;
    const rawOffset = rawValue - worstValue;
    const ratio = rawRange > 0 ? rawOffset / rawRange : 0;
    return Math.max(0, Math.round(worstScore + ratio * scoreRange));
  } else {
    // Times: extrapolate from very long time = 0 points
    const worstValue = t[0][0] * 2;
    const worstScore = 0;
    const rawRange = t[0][0] - worstValue;
    const scoreRange = t[0][1] - worstScore;
    const rawOffset = rawValue - worstValue;
    const ratio = rawRange > 0 ? rawOffset / rawRange : 0;
    return Math.max(0, Math.round(worstScore + ratio * scoreRange));
  }
}

// Build coach context from session state
async function buildCoachContext(session_id: string) {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_id', session_id)
    .single();

  if (sessionError) throw sessionError;

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true });

  const effectiveResults = await getEffectiveResults(session_id, session.user_id);

  // Calculate scores
  const confirmed_results: any = {};
  for (const [eventType, rawValue] of Object.entries(effectiveResults)) {
    confirmed_results[eventType] = {
      raw_value: rawValue,
      points: eventPoints(eventType, rawValue as number)
    };
  }

  // Calculate composite score
  const scores = Object.values(confirmed_results).map((r: any) => r.points);
  const provisional_score = scores.length > 0
    ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
    : 0;

  // Build leaderboard with revealed data only
  const leaderboard: any[] = [];
  const you: any = {
    rank: 1,
    name: 'You',
    overall_score: provisional_score
  };

  for (const [eventType, rawValue] of Object.entries(effectiveResults)) {
    you[eventType] = rawValue;
    you[eventType + '_score'] = confirmed_results[eventType].points;
  }

  leaderboard.push(you);

  // Add competitors (if any events are revealed)
  if (Object.keys(effectiveResults).length > 0) {
    const competitors = session.competitor_snapshot;
    const competitorNames = ['peer', 'steady', 'volatile', 'rival', 'ghost_you'];

    for (const name of competitorNames) {
      const competitor = competitors[name];
      if (!competitor) continue;

      const compScores = [];
      if (effectiveResults.pushups) {
        const score = eventPoints('pushups', competitor.pushups);
        compScores.push(score);
      }
      if (effectiveResults.plank) {
        const score = eventPoints('plank', competitor.plank);
        compScores.push(score);
      }
      if (effectiveResults.row_2k) {
        const score = eventPoints('row_2k', competitor.row_2k);
        compScores.push(score);
      }

      const compScore = compScores.length > 0
        ? Math.round(compScores.reduce((a, b) => a + b, 0) / compScores.length)
        : 0;

      const compRow: any = {
        rank: 0,
        name: name === 'ghost_you' ? 'Ghost You' : name.charAt(0).toUpperCase() + name.slice(1),
        overall_score: compScore
      };

      if (effectiveResults.pushups) {
        compRow.pushups = competitor.pushups;
        compRow.pushups_score = eventPoints('pushups', competitor.pushups);
      }
      if (effectiveResults.plank) {
        compRow.plank = competitor.plank;
        compRow.plank_score = eventPoints('plank', competitor.plank);
      }
      if (effectiveResults.row_2k) {
        compRow.row_2k = competitor.row_2k;
        compRow.row_2k_score = eventPoints('row_2k', competitor.row_2k);
      }

      leaderboard.push(compRow);
    }
  }

  return {
    confirmed_results,
    provisional_score,
    category: getCategoryLabel(provisional_score),
    leaderboard: leaderboard.sort((a, b) => b.overall_score - a.overall_score)
      .map((row, i) => ({ ...row, rank: i + 1 }))
  };
}

function getCategoryLabel(score: number): string {
  if (score >= 100) return 'Outstanding';
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Satisfactory';
  return 'Does Not Meet Standards';
}

// Call Anthropic API for coaching
async function callAnthropicCoach(context: any, question?: string): Promise<string> {
  const systemPrompt = `You are a friendly PRT (Physical Readiness Test) coach. The user is logging their Saturday PRT results in real-time.
You have access to their confirmed results, current score, leaderboard with simulated competitors, and recent performance trends.
Keep your advice short (2-3 sentences), actionable, and encouraging.
Never invent scores, ranks, or competitor results. Only use the facts provided in the context.
If they ask about performance, refer to their actual numbers and trends.`;

  const userMessage = question
    ? `User question: "${question}". Context: ${JSON.stringify(context, null, 2)}`
    : `Give me one piece of immediate advice for my current performance. Context: ${JSON.stringify(context, null, 2)}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-1-20250805',
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage
        }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content[0]?.text || 'No advice available';
}

serve(async (req: Request) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: CoachRequest = await req.json();
    const { session_id, question } = body;

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: 'Missing session_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify session belongs to user
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_id')
      .eq('session_id', session_id)
      .single();

    if (sessionError || !session || session.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Session not found or access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build context
    const context = await buildCoachContext(session_id);

    // Get coaching advice
    const advice = await callAnthropicCoach(context, question);

    const response: CoachResponse = {
      advice,
      session_id
    };

    return new Response(
      JSON.stringify(response),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    console.error('Coach function error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});
