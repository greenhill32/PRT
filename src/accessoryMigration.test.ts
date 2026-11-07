import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
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
    INSERT INTO auth.users VALUES ('${owner}');
  `);
  await db.exec(migration('001_init_prt.sql'));
  await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.events TO authenticated');
  await db.exec(migration('002_allow_session_completion.sql'));
  await db.exec(migration('003_repair_session_completion.sql'));
  await db.exec(migration('004_accessory_events.sql'));
  await db.query(`INSERT INTO public.sessions(session_id,user_id,competitor_seed,competitor_snapshot,state)
    VALUES ($1,$2,1,'{}','in_progress')`, [sessionId, owner]);
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
}, 30000);
afterAll(async () => { await db.close(); });

describe('migration 004: accessory events', () => {
  it('accepts accessory rows', async () => {
    await db.query(`INSERT INTO public.events(event_id,session_id,event_type,raw_value,unit,timestamp,detail)
      VALUES (gen_random_uuid(),$1,'accessory',8,'reps',now(),'{"exercise":"lat_pulldown"}')`, [sessionId]);
    expect((await db.query("SELECT 1 FROM public.events WHERE event_type='accessory'")).rows).toHaveLength(1);
  });

  it('still rejects unknown event types', async () => {
    await expect(db.query(`INSERT INTO public.events(event_id,session_id,event_type,raw_value,unit,timestamp)
      VALUES (gen_random_uuid(),$1,'squat',1,'reps',now())`, [sessionId])).rejects.toThrow(/events_event_type_check/);
  });

  it('does not let accessory rows alone satisfy the three-result completion rule', async () => {
    await expect(db.query("UPDATE public.sessions SET state='completed',completed_at=now() WHERE session_id=$1", [sessionId]))
      .rejects.toThrow(/row-level security/);
  });
});
