// Supabase activity heartbeat. Read-only: signs in as a dedicated user that owns
// no sessions or events, then reads one row through PostgREST. RLS limits the read
// to that user's own rows, so it never touches workout data and never writes.
import { pathToFileURL } from 'node:url';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function loadConfig(env) {
  const config = {
    url: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: env.SUPABASE_PUBLISHABLE_KEY || '',
    email: env.KEEPALIVE_EMAIL || '',
    password: env.KEEPALIVE_PASSWORD || ''
  };
  const missing = Object.entries({
    SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.key,
    KEEPALIVE_EMAIL: config.email, KEEPALIVE_PASSWORD: config.password
  }).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing secret(s): ${missing.join(', ')}`);
  if (!config.url.startsWith('https://')) throw new Error('SUPABASE_URL must start with https://');
  return config;
}

// Network errors, 429 and 5xx are transient. Other 4xx responses fail immediately.
export async function withRetry(label, operation, {
  attempts = MAX_ATTEMPTS, baseDelayMs = BASE_DELAY_MS, sleep = delay, log = console.log
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!error.retryable || attempt === attempts) break;
      const wait = baseDelayMs * 2 ** (attempt - 1);
      log(`${label}: attempt ${attempt} failed (${error.message}); retrying in ${wait} ms`);
      await sleep(wait);
    }
  }
  throw lastError;
}

// Response bodies are never included in error messages, so they cannot leak credentials.
async function request(fetchImpl, url, init) {
  let response;
  try { response = await fetchImpl(url, init); }
  catch (cause) { throw Object.assign(new Error(`network error (${cause.message})`), { retryable: true }); }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(`HTTP ${response.status}`), { retryable });
  }
  try { return await response.json(); }
  catch { throw Object.assign(new Error('non-JSON response (project may be paused or unavailable)'), { retryable: true }); }
}

export async function signIn(fetchImpl, config) {
  const data = await request(fetchImpl, `${config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password })
  });
  if (!data?.access_token) throw new Error('sign-in returned no access token');
  return data.access_token;
}

export async function readOneRow(fetchImpl, config, accessToken) {
  const rows = await request(fetchImpl, `${config.url}/rest/v1/sessions?select=session_id&limit=1`, {
    headers: { apikey: config.key, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  if (!Array.isArray(rows)) throw new Error('unexpected response shape from sessions read');
  return rows.length;
}

export async function runKeepalive({
  env = process.env, fetchImpl = fetch, sleep = delay, log = console.log
} = {}) {
  const config = loadConfig(env);
  const options = { sleep, log };
  const token = await withRetry('sign-in', () => signIn(fetchImpl, config), options);
  const rows = await withRetry('read', () => readOneRow(fetchImpl, config, token), options);
  log(`Supabase heartbeat OK: authenticated read-only query returned ${rows} row(s).`);
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeepalive().catch(error => {
    console.error(`Supabase heartbeat FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
