# PROJECT.md — PRT Virtual Gym

- **Project ID:** prt
- **Aliases:** prt-gym, prt-coach, virtual-gym
- **Type:** App (PWA)
- **Status:** PLANNING
- **Created:** 2026-10-29
- **Last reviewed:** 2026-10-29

## Purpose

A PWA for Saturday PRT (Physical Readiness Test) sessions. You log push-ups, plank, and 2,000m row. Simulated competitors appear one event at a time as you complete each. An AI coach reads the live session and offers coaching. Results are stored once in an append-only ledger; all scores, tiers, rankings and PBs are derived from it — there is no points column anywhere, which is the key lesson from the failed earlier virtual gym.

User: Lee (one person). Success: complete one satisfying loop — start Saturday PRT, log three events, see ranking vs simulated athletes, get coaching, save, and try to climb next week.

## Current status

PRD complete and reviewed. Starting V1 build. No code yet.

## Architecture

**Front end:** React 19 + TypeScript + Vite, deployed as a PWA (installable, works offline for result entry).

**Back end:** Supabase Postgres for the append-only ledger and sessions table, with Row Level Security. One Supabase Edge Function for the coaching endpoint.

**Hosting:** Vercel (PWA). Supabase free tier. Anthropic API for coaching.

**Auth:** Supabase Auth (magic link or email+password). One user per session.

**Offline sync:** Results are confirmed to IndexedDB locally, then synced to Supabase via background sync when online. UUID ensures idempotence. Coach is online-only.

## Main workflow

1. Start session — competitors generated from your baseline, hidden
2. Enter push-ups, confirm → event appended, competitor push-ups revealed, leaderboard updated (provisional)
3. Enter plank, confirm → same reveal and update
4. Enter 2k row, confirm → leaderboard becomes final
5. Coach Me (automatic advice) or Ask Coach (free-text question) at any point
6. Save session → becomes next week's baseline

## Important files

(To be created during V1 build)

- `src/App.tsx`, `src/screens/` — main screens
- `src/useSessionState.ts` — session state, local queue, sync
- `src/scoring.ts` — the shared scoring module (only place points are computed)
- `src/competitors.ts` — competitor generation and reveal logic
- `src/coach.ts` — coach endpoint integration
- `src/types.ts` — event, session, competitor types
- `supabase/migrations/` — ledger schema and RLS policies
- `supabase/functions/coach/` — Edge Function for coaching endpoint

## Data / storage

**Two tables in Supabase:**

**events** (append-only ledger):
- `event_id` — UUID, client-generated (enables idempotent retries)
- `session_id` — FK to sessions, NOT NULL
- `event_type` — pushups | plank | row_2k | bike | void
- `raw_value` — reps or seconds (null on void rows)
- `unit` — reps or s
- `timestamp` — client time of confirmation
- `source` — app or pm5 (later)
- `correction_of` / `voids_event_id` — links corrections to replaced rows
- `detail` — optional (500m split, stroke rate for row)

**sessions**:
- `session_id`, `user_id`, `kind` — kind is saturday_prt or practice
- `started_at`, `completed_at`, `state` — state is in_progress or completed
- `scoring_version` — makes history reproducible
- `competitor_model_version`, `competitor_seed` — makes generation deterministic
- `baseline_snapshot` — medians used to generate competitors
- `competitor_snapshot` — generated results and Ghost reference, stored once

**Offline:** IndexedDB queue for unsync'd events. Baseline and competitor snapshot cached locally at session start.

## External dependencies

- Supabase Auth (magic link or email+password)
- Supabase Postgres with RLS
- Supabase Edge Functions
- Anthropic API (coach endpoint only)
- Vercel (PWA hosting)

## Security / access / network exposure

**Auth:** Supabase Auth with JWT. One user per session.

**RLS:** Row Level Security on events and sessions tables — users can only insert/select their own rows, never update or delete. Append-only enforced by policy, not by code.

**Coach endpoint:** Edge Function verifies caller via Supabase Auth JWT. Fetches session context itself; does not trust facts sent by the browser. Queries as the authenticated user, so RLS applies. API key stored only as Edge Function secret.

**AI coaching:** Coach must not calculate authoritative scores, decide leaderboard positions, generate canonical competitor results, or rewrite history. It interprets facts only.

**Availability:** PWA works offline for result entry. Coach is online-only. Results queue offline.

## Decisions made and why

- **Append-only ledger, no points column.** The failure mode from the earlier virtual gym was point inflation, corrections bleeding through, and unreproducible leaderboards. Everything derived from one immutable ledger ensures the same dataset always gives the same leaderboard, and every score is auditable.

- **Competitors generated once at session start, snapshotted.** Past leaderboards must never change when you log new results later. Generation is the one deliberate exception to "derive everything."

- **Offline-capable for result entry, not for coaching.** A gym Wi-Fi drop must never lose a result. Coach calls require the network, so they queue or fail gracefully.

- **One shared scoring module, used by both client and Edge Function.** Client uses it for instant feedback; Edge Function recalculates independently and is authoritative. Splitting scoring invites drift; one module and an equality test prevent it.

- **Rival anchored to your baseline, not its own history.** Rival cannot ratchet out of reach and can always be beaten on a good day.

- **Supabase free tier, Vercel free tier, low API spend.** No custom WebSocket server, no Realtime, no Bluetooth for V1. A few cents per session in Anthropic calls.

## Known problems / gotchas

- None yet — planning phase.

## Open questions (blockers for real scoring)

- [ ] Which PRT standard, age band, and sex category apply? The official tables must be transcribed and verified before any score is trusted. If tables are not supplied, the build agent must stop and ask, not invent thresholds.
- [ ] How is the combined "Score" column defined, given PRT is normally tier-per-event?
- [ ] Rival's edge: start at 0.3–0.5 SD better than your baseline; tune after real sessions.
- [ ] Cold start: confirm tier-based defaults for the first 2–3 sessions.
- [ ] Ghost You: always your best session, or selectable?
- [ ] Is the gym rower a Concept2 PM5? Decides whether live telemetry build is worth it later.

## Out of scope (V1)

- General workout tracking, sets and reps, nutrition
- Social features, badges, wearables
- Custom WebSocket server or live realtime second screen
- Live PM5 Bluetooth telemetry during the row
- Letting the AI calculate scores, rank athletes, or generate canonical competitors
- Bike test (optional, later)

## Recovery notes

If it breaks:
1. Check `git status` and `git log`
2. Verify Supabase connection and RLS policies
3. Test: recomputing the leaderboard from raw ledger rows must equal what the UI displays
4. Check `npm run dev` and the browser console for errors
5. Verify IndexedDB local queue if offline sync is failing

## Next 3 things

1. **Design deliverables** — before code, produce schema + RLS, ledger design with void handling, scoring module structure, competitor generation, reveal state machine, coach context contract, screen flow, offline-sync strategy
2. **Verify PRT scoring tables** — get the official tables for your standard/age/sex and transcribe them into the scoring module
3. **Build scoring module with tests** — the single source of truth; client and Edge Function both use it

## AI handoff instructions

Read this file and `git status` before changing anything. The PRD is in the Waystation upload `00mvtt626ad11c33ab` (fetch via `/api/download`). Don't delete, move, or restructure files without flagging it first. Prefer small, testable changes. Keep the append-only ledger pattern sacred — no edit/delete operations, only append and void. Update Status / Known Problems / Next 3 Things after significant work. Scope is locked to one-person Saturday PRT sessions in V1 — no multi-user, no general workout tracking, no recipes or nutrition.

## Recent important history

2026-10-29 — PRD received and reviewed. Project initialized. No code yet. Blocking decision: need official PRT scoring tables before real scoring can be built.
