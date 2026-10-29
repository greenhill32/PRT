PRT Virtual Gym: product requirements
29 Oct 2026 · @Lee
Summary
A small PWA for Saturday PRT sessions: you log push-ups, plank and a 2,000 m row, simulated competitors appear one event at a time, and an AI coach reads the live session. Your results are real, your opponents are simulated, and the coach helps you climb between attempts.
The one rule that shapes everything: results are stored once, in an append-only ledger. Scores, tiers, rankings and PBs are always derived from it. There is no points column anywhere, which is the lesson from the failed earlier virtual gym.
The data flow is a single line:
1. PRT result is confirmed and appended to the ledger.
2. The shared scoring module derives event points, composite score and tier.
3. Competitor results (already generated at session start) are revealed for that event.
4. The leaderboard is derived from the ledger plus revealed competitor values.
5. The coach context is built from the same derived facts, revealed data only.
Goals and non-goals
V1 delivers one satisfying loop: start Saturday PRT, complete the three events, see how you rank against simulated athletes, get coaching, save, and try to climb next week.
Goals
• Log push-ups, forearm plank and 2,000 m row; bike is optional later.
• Show a provisional leaderboard that updates after every confirmed event.
• Offer Coach Me (automatic advice) and Ask Coach (free-text question) with session context attached automatically.
• Keep every score reproducible: the same ledger always gives the same leaderboard.
• Work through a gym Wi-Fi drop without losing results.
Non-goals for V1
• General workout tracking, sets and reps, nutrition, social features, badges, wearables.
• A custom WebSocket server. Realtime is only for a second screen, later.
• Live PM5 Bluetooth telemetry during the row.
• Letting the AI calculate scores, rank athletes or generate competitor results.
Core loop and screens
One screen carries the whole session. A working prototype of it exists (the published preview page), with placeholder scoring.
Session flow
1. Start session. Competitors are generated from the seed and your baseline, then hidden.
2. Enter push-ups, confirm. The event is appended, competitor push-ups are revealed, the leaderboard updates as provisional.
3. Enter plank, confirm. Same reveal and update.
4. Enter 2k row (optional average 500 m split and stroke rate), confirm. The leaderboard becomes final.
5. Coach Me or Ask Coach at any point.
6. Save session. It becomes part of next Saturday's baseline.
Main screen contents
• Event track showing done, current and waiting events, with a Correct link on confirmed ones.
• Standing: current tier, provisional or final score, points to the next tier.
• Entry panel for the current event, with the time or reps needed for the next tier when only one event remains.
• Leaderboard (the focal element): You, Peer, Steady, Volatile, Rival, Ghost PB. Unrevealed cells stay blank. Rows animate to their new rank.
• Coach panel with Coach Me and Ask Coach.
• Collapsed section showing the ledger and the exact coach context, for transparency and debugging.
Data model
Two tables. The events table is the single source of truth and is append-only; sessions holds grouping, versions and the competitor snapshot.
events (the ledger)
Field
Notes
event_id
UUID generated on the client, so retries are idempotent
session_id
NOT NULL. Every event belongs to a session; a standalone Wednesday test is a practice session
event_type
pushups, plank, row_2k, bike, or void
raw_value
Reps or seconds. Null on void rows
unit
reps or s
timestamp
Client time of confirmation
source
app, later pm5
correction_of / voids_event_id
Links a correction to the row it replaces
optional detail
Average 500 m split, stroke rate (row only)
sessions
Field
Notes
session_id, user_id, kind
Owner via Supabase Auth. kind is saturday_prt or practice; practice sessions have no competitors or leaderboard
started_at, completed_at, state
state is in_progress or completed
scoring_version
Scoring standard used at the time, so history stays reproducible
competitor_model_version, competitor_seed
Makes generation deterministic
baseline_snapshot
The medians used to generate competitors
competitor_snapshot
Generated competitor results and the Ghost reference, stored once
Rules
• No points, tier or rank column exists anywhere. Everything is derived.
• Corrections never edit or delete. Append a void row pointing at the old event, then append the corrected result. The effective result is the latest non-voided row per event type.
• Row Level Security allows insert and select on events by owner, with no update or delete policy, so append-only is enforced by the database.
• Test: recomputing the leaderboard from raw ledger rows must equal what the UI displays.
Scoring
One shared TypeScript module is the only place points are computed. The client uses it for instant feedback; the Edge Function recalculates independently and is authoritative.
Module contract
• eventPoints(type, rawValue, profile, version) returns points for one event.
• composite(results, version) returns the session score from the confirmed events only.
• tierOf(score, version) returns the tier and the next tier with its threshold.
• gapToNextTier(...) returns the points gap, and the raw value needed on a single event to close it.
• scoringVersion is stored on each session, so a standards change never rewrites history.
Rules
• Leaderboard scoring uses only the current session. Previous sessions inform competitor ability, PBs and trends, never the current score.
• Provisional standing is the composite over confirmed events; it becomes final when all required events are in.
• Everyone on the leaderboard, competitors included, is scored over the same set of revealed events.
Status: placeholder. The prototype uses made-up linear curves tuned to reproduce the mock numbers. The official PRT tables for your standard, age band and sex category must be transcribed and verified against the current instruction before any score is trusted. If the tables are not supplied, the build agent must stop and ask rather than invent thresholds. The composite formula also needs to be defined explicitly, since PRT is normally tier-per-event.
Competitors
Competitors are the one deliberate exception to "derive everything": they are generated once at session start and snapshotted, so a past leaderboard never changes when you log new results later.
Baseline. Median per event over your last 3 to 5 completed saturday_prt sessions (practice sessions are excluded). It is used only to generate competitors and never affects the current score. With fewer than 3 sessions, use tier-based defaults; Ghost You is absent until a prior session exists.
Personas (offsets and variance are in units of your own per-event spread; tune in testing)
Competitor
Expected ability
Session form variance
Per-event noise
Peer
Your baseline
Medium
Medium
Steady
Your baseline
Low
Low
Volatile
Your baseline
High
High
Rival
About 0.3 to 0.5 SD better than your baseline
Medium
Medium
Ghost You
Fixed: your best or a selected past session
None
None
Generation
1. Seed a deterministic PRNG from the session's competitor_seed plus the competitor id.
2. Draw one session form value per competitor (a good or bad day that carries across events).
3. Draw per-event noise.
4. Ability = persona offset + form x form weight + noise x noise weight.
5. Convert to a result. Push-ups are a bounded count. Plank and row times use a log-normal shape, because they are positive and right-skewed.
6. Store the full set in the session snapshot with the model version.
Rival is anchored to your baseline, not to its own history, so it cannot ratchet out of reach and can always be beaten on a good day.
Reveal rule. All values exist from the start but stay hidden. A competitor's value for an event is revealed only after your result for that event is confirmed. The coach never receives unrevealed values.
Coach
Coach Me and Ask Coach are the same endpoint. The only difference is whether a question is supplied.
Endpoint. POST /coach with session_id and an optional question. The Edge Function verifies the caller with Supabase Auth, fetches the session context itself from the database, and never trusts facts sent by the browser. It queries as the caller (their JWT plus the publishable key) so RLS applies, and it does not use the secret key. The model API key lives only as an Edge Function secret.
Context contract (facts the code supplies)
• Confirmed results and their points for this session, and which events are still pending.
• Provisional or final score, current tier, gap to the next tier, and the cheapest raw improvement per event to close it.
• Revealed competitor results only, and the current leaderboard.
• Recent sessions, PBs and trend.
• Optional row splits and stroke rate if entered.
Behaviour
• Coach Me: no question. Returns the single most useful short piece of advice for the current state.
• Ask Coach: answers the free-text question using the same context, for example "My row was 9:07 and I faded badly near the end. What should I change next Saturday?"
The AI must not calculate authoritative scores, decide leaderboard positions, generate canonical competitor results or rewrite history. Normal code owns scoring, tiers, rankings, PBs, baselines, simulation and reveal state; the model only interprets facts.
Availability. The coach is online-only. Results queue offline; the coach does not.
Offline and sync
A gym Wi-Fi drop must never lose a result. Confirming an event works fully offline.
• Confirming writes the event to a local queue (IndexedDB) with its client-generated UUID, and the UI updates immediately from local state.
• A background sync inserts queued events into Supabase when online. Because the UUID is the primary key, retries are safe and duplicates are ignored.
• The session header shows a queued count while anything is unsynced.
• Competitor snapshot and baseline are created at session start and cached locally. Starting a brand-new session offline uses the last cached baseline.
• Corrections work offline the same way: a void row and a new row are both queued, in order.
• The server recalculates from the synced ledger, so a client and server disagreement resolves in the server's favour.
• Needs a connection: the coach, and the first sign-in. Everything else works offline.
Architecture and setup
PWA front end, Supabase Postgres, one Edge Function for the coach. No custom WebSocket layer in V1.
Need
What
Where it lives
Supabase project
Free tier
supabase.com
SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
Safe to expose, protected by RLS
PWA environment variables (use your bundler's public prefix, for example VITE_)
SUPABASE_SECRET_KEY, only if actually needed
Bypasses RLS. Edge Functions already receive Supabase keys automatically, so V1 likely needs it only for local migration or seed scripts
Edge Function only, never the client
ANTHROPIC_API_KEY
Coach calls
Edge Function secret, never the client or repo
PWA hosting
Vercel
Two Supabase values as env vars
Auth
Supabase Auth, magic link or email and password
Gives a user_id for RLS and stops the coach endpoint being an open credit drain
Tools
Node, Supabase CLI, Claude Code or Codex
Local
Why no WebSockets. One user, a few writes per session. Confirming an event is a single HTTP insert and the coach reads the ledger fresh when asked, so there is nothing to stream. Supabase Realtime (a table subscription, not a server to build) is only needed if a second screen should follow a live session.
Cost. Supabase and Vercel free tiers cover V1. The coach calls are the only spend, a few cents per session at most.
Not needed for V1: WebSocket server, Realtime, Bluetooth, RevenueCat, an Apple build.
Build plan
Before code, the agent produces the design deliverables below for review, then builds the smallest working V1.
Design deliverables
1. Supabase schema and RLS policies.
2. Event-ledger design, including void and correction handling.
3. Scoring module structure.
4. Competitor-generation algorithm.
5. Session and reveal state machine.
6. Coach context contract.
7. PWA screen flow.
8. Offline-sync strategy.
V1 build order
1. Scoring module with tests, using verified PRT tables.
2. Ledger, sessions and RLS, plus a test that recomputing from raw rows equals the displayed leaderboard.
3. Competitor generation with snapshot and reveal gating.
4. Session screen, with local queue and sync.
5. Auth and the coach Edge Function with the context contract.
Later
• Optional bike test.
• Supabase Realtime for a second screen.
• Native Expo build to read Concept2 PM5 Bluetooth telemetry (live pace, projected finish, virtual competitors without touching the phone). iOS Safari has no Web Bluetooth, so this needs native. Check first whether ErgData already covers the need.
Open questions and risks
[ ] Which PRT standard, age band and sex category apply? Blocks all real scoring.
[ ] How is the combined "Score" column defined, given PRT is normally tier-per-event? Define once in the scoring module and version it.
[ ] Rival's edge: start at 0.3 to 0.5 SD better than your baseline and tune after a few sessions.
[ ] Cold start: confirm the tier-based default baselines for the first 2 to 3 sessions.
[ ] Ghost You: always the best session, or selectable?
[ ] Is the gym rower a Concept2 PM5? Decides whether the later telemetry version is worth building.
[ ] Does ErgData already give enough live pace and race features on the rower itself?
Risks
• Wrong scoring tables would make every number misleading. Verify against the official source, not memory.
• Competitor tuning can feel too easy or too hard; expect to adjust variance after real sessions.
• Splitting scoring between client and server invites drift. Keep one shared module and test equality.