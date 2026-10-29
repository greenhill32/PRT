import { describe, it, expect } from 'vitest';
import { createCoachHandler, CoachHttpError } from '../supabase/functions/_shared/coachHandler';
const origin = 'https://prt-brown-eta.vercel.app';
const id = '11111111-1111-4111-8111-111111111111';
const handler = (loadContext = async (_token: string, _id: string) => ({})) =>
  createCoachHandler({ allowedOrigins: [origin], loadContext, getAdvice: async () => 'Advice' });
const post = (body: unknown, auth = true) => new Request(origin + '/coach', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-jwt' } : {}) },
  body: JSON.stringify(body)
});
describe('Coach HTTP contract', () => {
  it('permits every header sent by the Supabase functions client', async () => {
    const response = await handler()(new Request(origin + '/coach', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Headers': 'apikey,x-client-info,authorization,content-type' }
    }));
    expect(response.status).toBe(204);
    const headers = response.headers.get('Access-Control-Allow-Headers');
    for (const name of ['apikey', 'x-client-info', 'authorization', 'content-type']) expect(headers).toContain(name);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
  it('returns CORS headers on auth failures as well as successful requests', async () => {
    const unauthorized = await handler()(post({ session_id: id }, false));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const success = await handler()(post({ session_id: id }));
    expect(await success.json()).toEqual({ advice: 'Advice', session_id: id });
  });
  it('rejects unknown origins and invalid session IDs', async () => {
    expect((await handler()(new Request(origin, { method: 'OPTIONS', headers: { Origin: 'https://unknown.test' } }))).status).toBe(403);
    expect((await handler()(post({ session_id: 'bad' }))).status).toBe(400);
  });
  it('preserves safe auth errors with CORS', async () => {
    const response = await handler(async () => { throw new CoachHttpError(403, 'Session not found or access denied'); })(post({ session_id: id }));
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
});
