# PRT Virtual Gym — Status

Updated: 29 October 2026.

The repository contains fixes for scoring, session completion, reload recovery, upload retries, opponent calibration and coach CORS. Local verification is recorded below. The live Supabase/Vercel deployment still needs the steps in [DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md).

## Current design

- React/TypeScript/Vite PWA, Supabase Auth/Postgres, one coach Edge Function.
- Shared scoring, effective-ledger calculation and leaderboard code lives in `supabase/functions/_shared/`. Frontend modules re-export it; the coach imports it directly.
- Events remain append-only. Scores and rankings are derived from raw results. Zero points count in every participant's average.
- Session UPDATE grants cover only state/completed_at. RLS permits the owner to complete an in-progress session only after all three effective results are persisted.
- Migration 002 is corrected for new installs; migration 003 repairs an existing installation. Neither changes workout rows.
- Competitor model 2.0 uses seeded distributions and a Rival advantage of 0.4 SD. Better performance means more push-ups, longer plank and faster rowing. Existing opponent snapshots are preserved.
- Practice sessions appear in history and have no leaderboard. Completed sessions can be reopened read-only.

## Offline behaviour

A session must initially be created online. After it has been cached, its session/results and local queue can be restored when the connection drops, provided the user still has a cached signed-in session.

Confirmations commit to IndexedDB before advancing. The view merges persisted and queued rows by UUID, derives event reveals from effective results, and resumes at the next missing event. Successful uploads are cached before the queue row is removed.

Failed and interrupted uploads are retried. Duplicate UUIDs count as success only after reading the persisted row and checking its payload. Failed/syncing rows remain in the unsynced count.

Completion and coaching require internet. Completion waits for sync, checks the session's actual pending queue, and reads persisted results before updating state. An unrelated session's failed upload does not block a completed one.

## Verification

Run `npm ci`, `npm test`, and `npm run build`.

Regression coverage includes:
- Below-minimum row interpolation and zero-point averages.
- Shared app/coach results and hidden-event gating.
- Seed reproducibility and Rival performance distributions.
- Input parsing, offline unmount/remount recovery and practice sessions.
- Queue retries, interrupted uploads, concurrent sync, duplicate UUID verification and completion gating.
- PostgreSQL migration/RLS behaviour in PGlite, including immutable fields and append-only events.
- Coach preflight/auth errors and same-user auth refresh during a workout.

These are local checks with test data and mocked external services. They do not prove that migrations, function secrets, hosting variables or the coach function are deployed correctly.

## Deployment

Follow [DEPLOY_HANDOFF.md](DEPLOY_HANDOFF.md). Do not rerun migration 001 against existing tables or delete existing history. Set `ANTHROPIC_API_KEY` only in Supabase secrets. Optional function settings: `ANTHROPIC_MODEL`, `COACH_ALLOWED_ORIGINS` (comma-separated exact origins; the production app is allowed by default).

The coach now queries with the caller's JWT and an automatically supplied Supabase anon/publishable key, so RLS applies. It no longer needs the service-role key.

A live iPhone/Safari smoke test and one real authenticated coach call remain outstanding.
