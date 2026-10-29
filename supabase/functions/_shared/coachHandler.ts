export class CoachHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function createCoachHandler(options: {
  allowedOrigins: string[];
  loadContext: (token: string, sessionId: string) => Promise<unknown>;
  getAdvice: (context: unknown, question?: string) => Promise<string>;
}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const allowed = !origin || options.allowedOrigins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    };
    if (origin && allowed) headers['Access-Control-Allow-Origin'] = origin;
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed) return response({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return response({ error: 'Unauthorized' }, 401);
    let body: any;
    try { body = await request.json(); }
    catch { return response({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body.session_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.session_id)
      || (body.question !== undefined && (typeof body.question !== 'string' || body.question.length > 2000))) {
      return response({ error: 'Provide a valid session_id and a question of at most 2000 characters.' }, 400);
    }
    try {
      const context = await options.loadContext(auth.slice(7), body.session_id);
      const advice = await options.getAdvice(context, body.question);
      return response({ advice, session_id: body.session_id });
    } catch (error) {
      if (error instanceof CoachHttpError) return response({ error: error.message }, error.status);
      console.error('Coach function error:', error);
      return response({ error: 'Unable to provide coaching at this time' }, 500);
    }
  };
}
