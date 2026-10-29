# PRT Virtual Gym

A PWA for Saturday PRT (Physical Readiness Test) sessions: log push-ups, plank, and 2,000m row, race simulated competitors, and get real-time AI coaching.

## Quick start

```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
npm run preview
```

## Key features

- **Event logging** — record push-ups, forearm plank (seconds), and 2,000m row with optional row splits and stroke rate
- **Live leaderboard** — see your score and ranking against simulated competitors (Peer, Steady, Volatile, Rival, Ghost You) as results are confirmed
- **AI coaching** — "Coach Me" for immediate advice, or "Ask Coach" for free-text questions with full session context
- **Offline-capable** — confirm results fully offline; they queue and sync when back online
- **Append-only ledger** — all results stored immutably; corrections append a void row, never edit or delete

## Main workflow

1. Start a Saturday PRT session
2. Enter push-ups, confirm → competitor push-ups revealed
3. Enter plank, confirm → competitor plank times revealed
4. Enter 2k row, confirm → leaderboard becomes final
5. Ask Coach for feedback or advice
6. Save session → becomes baseline for next week's competitors

## Architecture

- **Front end:** React + TypeScript + Vite (PWA with IndexedDB local queue for offline sync)
- **Back end:** Supabase Postgres (append-only ledger) + Edge Function (coaching endpoint)
- **Hosting:** Vercel
- **Auth:** Supabase Auth (magic link / email+password)
- **Coaching API:** Anthropic Claude

See `PROJECT.md` for full architecture and data model.
