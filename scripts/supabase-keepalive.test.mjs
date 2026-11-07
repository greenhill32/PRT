import { describe, it, expect, vi } from 'vitest';
import { loadConfig, runKeepalive, withRetry } from './supabase-keepalive.mjs';

const env = {
  SUPABASE_URL: 'https://example.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  KEEPALIVE_EMAIL: 'heartbeat@example.test',
  KEEPALIVE_PASSWORD: 'test-password'
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});
const noSleep = async () => {};

describe('loadConfig', () => {
  it('names missing secrets without printing values', () => {
    expect(() => loadConfig({ ...env, KEEPALIVE_PASSWORD: '' })).toThrow('Missing secret(s): KEEPALIVE_PASSWORD');
  });

  it('rejects non-https URLs and strips trailing slashes', () => {
    expect(() => loadConfig({ ...env, SUPABASE_URL: 'http://example.test' })).toThrow('https://');
    expect(loadConfig(env).url).toBe('https://example.supabase.co');
  });
});

describe('runKeepalive', () => {
  it('signs in and performs one GET, never a write', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: 'jwt' }))
      .mockResolvedValueOnce(json(200, []));
    const log = vi.fn();

    await expect(runKeepalive({ env, fetchImpl, sleep: noSleep, log })).resolves.toBe(0);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [signInUrl, signInInit] = fetchImpl.mock.calls[0];
    expect(signInUrl).toBe('https://example.supabase.co/auth/v1/token?grant_type=password');
    expect(signInInit.method).toBe('POST');
    const [readUrl, readInit] = fetchImpl.mock.calls[1];
    expect(readUrl).toContain('/rest/v1/sessions?select=session_id&limit=1');
    expect(readInit.method).toBeUndefined();
    expect(readInit.headers.Authorization).toBe('Bearer jwt');
    expect(log.mock.calls.flat().join('\n')).not.toContain('test-password');
  });

  it('retries a transient 503 and then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(json(200, { access_token: 'jwt' }))
      .mockResolvedValueOnce(json(200, [{ session_id: 'x' }]));
    const log = vi.fn();

    await expect(runKeepalive({ env, fetchImpl, sleep: noSleep, log })).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.flat().join('\n')).toContain('retrying');
  });

  it('does not retry bad credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(400, { error: 'invalid_grant' }));
    await expect(runKeepalive({ env, fetchImpl, sleep: noSleep, log: () => {} }))
      .rejects.toThrow('HTTP 400');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails after bounded retries when the project is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const sleep = vi.fn(noSleep);
    await expect(runKeepalive({ env, fetchImpl, sleep, log: () => {} }))
      .rejects.toThrow('network error');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 8000]);
  });
});

describe('withRetry', () => {
  it('gives up immediately on non-retryable errors', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { retryable: false }));
    await expect(withRetry('x', operation, { sleep: noSleep, log: () => {} })).rejects.toThrow('nope');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
