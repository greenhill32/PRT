# PRT deployment handoff prompt

You are working on https://github.com/greenhill32/PRT. Continue from the Codex correctness/recovery PR, not the earlier PASS 1–3 snapshot. Inspect the current branch and local changes before doing anything.

## Changes already implemented

1. Corrected migration 002's invalid OLD reference. Added forward repair migration 003. Owner completion is limited to an in-progress session, requires completed_at plus three persisted non-voided results, and cannot change snapshots/seeds or reopen completed sessions. No existing workout rows are modified.
2. Fixed the below-minimum rowing score cliff and zero-point competitor averages. App and coach now share scoring, effective-ledger calculation and leaderboard code in supabase/functions/_shared.
3. Recalibrated new competitors with seeded distributions. Rival is 0.4 SD stronger with natural overlap; stronger means longer plank and faster row. Model version is 2.0. Existing competitor snapshots stay unchanged.
4. Restored cached session/event data plus pending raw queue rows after reload. Rebuilt reveals and the next event from effective results. Confirmation waits for durable IndexedDB commit.
5. Recovered interrupted syncing rows, retried failures, shared concurrent sync work, and verified duplicate UUID payloads before removing queue items. All unsynced states remain counted per session. Completion waits for actual persisted results; no complete-anyway bypass.
6. Fixed practice-session history/leaderboard behaviour, completed-session read-only access, input validation, auth refresh navigation and listener cleanup.
7. Fixed coach preflight headers and CORS on every response. Coach queries now use the caller JWT under RLS rather than a service-role client. Added request validation, safe errors, an API timeout and optional ANTHROPIC_MODEL/COACH_ALLOWED_ORIGINS settings.
8. Supplied the missing PWA icons, corrected the mobile leaderboard's three-column layout, and updated scoring/status documentation.
9. Added regression tests for these changes, including PostgreSQL/RLS checks in PGlite and offline React session recovery. npm test and npm run build were run locally; external services were mocked.

## Remaining work requiring the configured local/deployment environment

### Changes to deployed configuration

- Review the PR, preserve any newer work, rerun npm ci, npm test and npm run build, and merge/deploy after verification.
- Use the existing configured Supabase project. Inspect the actual schema and migration history first; never print credentials or put secrets into Git.
- Apply the database repair. If migration 002 was already applied/recorded, apply 003. If 002 is pending, use the corrected 002 before 003. If schema 001 was applied manually, reconcile migration history before using db push. Do not rerun CREATE TABLE migration 001 against an existing database.
- Deploy the coach Edge Function from the updated checkout so its _shared dependencies are bundled. Verify SUPABASE_URL plus the automatically supplied anon/publishable key are available. Keep ANTHROPIC_API_KEY in Supabase secrets only.
- Verify the configured Anthropic model accepts a real request. ANTHROPIC_MODEL can override the existing default; do not assume model availability from unit tests.
- If needed, configure COACH_ALLOWED_ORIGINS with exact production/preview/development origins, comma-separated. The default allows https://prt-brown-eta.vercel.app. Avoid a wildcard.
- Confirm Vercel's VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, deploy the merged code, and confirm the new PWA build is active.

## Live verification

Use staging or a test account where available. Preserve existing workout history.

- Confirm push-ups 38, plank 2:02 and row 8:50 produce event scores 70/70/70 and overall 70.
- Check a 9:31 row no longer becomes zero, and a legitimate zero-point event contributes equally to user and opponent averages.
- Start a session online, confirm an event, lose connectivity, reload/reopen it, and confirm score/reveals/input stage recover. Enter another event offline, reconnect, and confirm each UUID uploads once.
- Interrupt an upload and verify it retries. Fail an upload and confirm the badge remains visible and Save cannot complete the session until that session's results persist.
- Complete the session and verify completed_at/state in Supabase, immutable fields unchanged, and the next Saturday's baseline/Ghost use real completed results.
- Check practice history and read-only completed sessions.
- On iPhone/Safari, verify PWA installation/icons, safe areas, numeric/time entry, the leaderboard and reload recovery.
- Make an authenticated Coach Me call. Check its OPTIONS response permits authorization, apikey, x-client-info and content-type; unauthorized errors should also have CORS headers.
- Confirm another authenticated user cannot read or complete the first user's sessions/events.

Report the commit/deployment checked, migrations actually applied, real tests performed, and anything still blocked. Distinguish deployed behaviour from local test results. Do not reset the database or silently rewrite historical raw results/opponent snapshots.
