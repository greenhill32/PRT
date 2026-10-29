import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id UUID PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE ROLE anon; CREATE ROLE authenticated;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    INSERT INTO auth.users VALUES ('${owner}'), ('${other}');
  `);
  await db.exec(migration('001_init_prt.sql'));
  // Simulate Supabase's default table grants before tightening UPDATE.
  await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.events TO authenticated');
  await db.exec(migration('002_allow_session_completion.sql'));
  await db.exec(migration('003_repair_session_completion.sql'));
  await db.exec(migration('003_repair_session_completion.sql'));
  await db.query(`INSERT INTO public.sessions(session_id,user_id,competitor_seed,competitor_snapshot) VALUES ($1,$2,1,'{}')`, [sessionId, owner]);
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
}, 30000);
afterAll(async () => { await db.close(); });

describe('PostgreSQL completion and ledger policies', () => {
  it('rejects incomplete completion', async () => {
    await expect(db.query("UPDATE public.sessions SET state='completed',completed_at=now() WHERE session_id=$1", [sessionId]))
      .rejects.toThrow(/row-level security/);
  });
  it('keeps snapshots immutable even for the owner', async () => {
    await expect(db.query("UPDATE public.sessions SET competitor_seed=99 WHERE session_id=$1", [sessionId]))
      .rejects.toThrow(/permission denied/);
  });
  it('persists all three events and refuses UPDATE/DELETE on the ledger', async () => {
    for (const [type, raw, unit] of [['pushups', 0, 'reps'], ['plank', 122, 's'], ['row_2k', 530, 's']]) {
      await db.query(`INSERT INTO public.events(event_id,session_id,event_type,raw_value,unit,timestamp)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,now())`, [sessionId, type, raw, unit]);
    }
    expect((await db.query("UPDATE public.events SET raw_value=999 RETURNING event_id")).rows).toHaveLength(0);
    expect((await db.query("DELETE FROM public.events RETURNING event_id")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM public.events")).rows).toHaveLength(3);
  });
  it('requires completed_at and prevents another user reading or completing the session', async () => {
    await expect(db.query("UPDATE public.sessions SET state='completed',completed_at=null WHERE session_id=$1", [sessionId]))
      .rejects.toThrow(/row-level security/);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [other]);
    expect((await db.query("SELECT * FROM public.events")).rows).toHaveLength(0);
    expect((await db.query("UPDATE public.sessions SET state='completed',completed_at=now() WHERE session_id=$1 RETURNING session_id", [sessionId])).rows).toHaveLength(0);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
  });
  it('allows one owner completion, including zero-rep results, and blocks reopening', async () => {
    expect((await db.query("UPDATE public.sessions SET state='completed',completed_at=now() WHERE session_id=$1 RETURNING session_id", [sessionId])).rows).toHaveLength(1);
    expect((await db.query("UPDATE public.sessions SET state='in_progress',completed_at=null WHERE session_id=$1 RETURNING session_id", [sessionId])).rows).toHaveLength(0);
    expect((await db.query("UPDATE public.sessions SET completed_at=now() WHERE session_id=$1 RETURNING session_id", [sessionId])).rows).toHaveLength(0);
  });
});
