import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0';
import { buildCoachContext } from '../_shared/coachContext.ts';
import { createCoachHandler, CoachHttpError } from '../_shared/coachHandler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
const allowedOrigins = (Deno.env.get('COACH_ALLOWED_ORIGINS') || 'https://prt-brown-eta.vercel.app')
  .split(',').map(origin => origin.trim()).filter(Boolean);

serve(createCoachHandler({
  allowedOrigins,
  async loadContext(token, sessionId) {
    // Request-scoped caller credentials: all queries are subject to the user's RLS.
    const client = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) throw new CoachHttpError(401, 'Unauthorized');
    const { data: session, error: sessionError } = await client.from('sessions')
      .select('*').eq('session_id', sessionId).single();
    if (sessionError || !session || session.user_id !== user.id) throw new CoachHttpError(403, 'Session not found or access denied');
    const { data: events, error } = await client.from('events').select('*').eq('session_id', sessionId);
    if (error) throw error;
    return buildCoachContext(session, events || []);
  },
  async getAdvice(context, question) {
    if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicApiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-1-20250805',
        max_tokens: 256,
        system: 'You are a friendly PRT coach. Give 2–3 concise, actionable sentences using only the provided confirmed results and revealed leaderboard. Never invent scores, ranks, competitors or history. No trends or PBs are supplied unless explicitly present in the context.',
        messages: [{ role: 'user', content: (question ? 'Question: ' + question : 'Give one piece of coaching advice.') + '\nContext: ' + JSON.stringify(context) }]
      })
    });
    if (!response.ok) throw new Error('Anthropic request failed: ' + response.status);
    const data = await response.json();
    return data.content?.find((block: { type: string }) => block.type === 'text')?.text || 'No advice available';
  }
}));
