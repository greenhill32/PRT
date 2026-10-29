You are building V1 of "PRT Virtual Gym", a small PWA for Saturday PRT sessions.
Spec: the "PRT Virtual Gym: product requirements" doc (paste or export it into
the repo as SPEC.md and treat it as authoritative). UX reference: preview.html.

SCOPE
Push-ups, forearm plank, 2,000 m row (bike later). Not a general fitness app:
no sets/reps, nutrition, social, badges or wearables. No WebSocket server.
No PM5/Bluetooth.

STACK
PWA (Vite + React + TypeScript), Supabase Postgres + Auth, one Edge Function
for the coach, Vercel hosting.
PWA env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (with the bundler's public prefix).
Edge Function: ANTHROPIC_API_KEY via supabase secrets. Supabase keys are
injected automatically. SUPABASE_SECRET_KEY only if truly needed, and never in
the client. The coach queries as the caller (their JWT + publishable key) so
RLS applies.

NON-NEGOTIABLE RULES
1. events is an append-only ledger and the single source of truth. No points,
   tier or rank column anywhere. Everything is derived.
2. events.session_id is NOT NULL. sessions.kind is saturday_prt | practice.
   Practice sessions have no competitors or leaderboard.
3. Corrections append a void row plus a new row. Never update or delete.
   RLS: insert/select by owner only, no update/delete policies.
4. event_id is a client-generated UUID so retries are idempotent.
5. One shared TypeScript scoring module, used by the client and recalculated
   by the Edge Function (authoritative). scoring_version is stored per session.
6. Competitors are generated once at session start (seeded PRNG, baseline =
   median of the last 3-5 completed saturday_prt sessions) and snapshotted.
   Results are hidden until the user confirms that event. Rival is about
   0.3-0.5 SD better than baseline and must be beatable. Times use log-normal.
   Ghost You is a fixed past session or PB.
7. The current leaderboard uses only the current session. History only
   informs baselines, PBs and trends.
8. Coach = one endpoint, POST /coach {session_id, question?}. The server builds
   the context itself from the DB and sends revealed data only. The AI never
   computes scores, ranks, or competitor results.
9. Offline: confirmations queue locally (IndexedDB) and sync later. The coach
   is online-only.

BLOCKER: SCORING TABLES
Do not invent PRT thresholds. If the official tables for the user's standard,
age band and sex category are not supplied, STOP and ask. Also ask how the
composite score is defined. Placeholder curves may be used only behind a
clearly labelled scoring_version.

PROCESS
Step 1: produce, without code, the 8 design deliverables: schema + RLS, ledger
design, scoring module structure, competitor algorithm, session/reveal state
machine, coach context contract, PWA screen flow, offline-sync strategy.
Then stop for my review.
Step 2: build the smallest working V1 in this order: scoring + tests, ledger +
RLS, a test that recomputing from raw rows equals the displayed leaderboard,
competitors + reveal gating, session screen + offline queue, auth + coach.
Keep it narrow. Do not add features not in the spec.
