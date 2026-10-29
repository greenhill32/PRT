# PRT Virtual Gym — Setup & Deployment

## Prerequisites

- Node.js 18+
- Supabase account (free tier works)
- Anthropic API key for coaching

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env` with your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

### 3. Run scoring tests

```bash
npm test
```

This verifies the Navy scoring tables and interpolation logic.

### 4. Start dev server

```bash
npm run dev
```

The app runs on `http://localhost:5173`.

## Supabase Setup

### 1. Create tables

Run the migration in `supabase/migrations/001_init_prt.sql` in your Supabase SQL editor to create:
- `sessions` table (PRT and practice sessions)
- `events` table (append-only ledger)
- RLS policies (users can only see/create their own data)

### 2. Deploy the Coach Edge Function

```bash
supabase functions deploy coach
```

Set the Edge Function secret:

```bash
supabase secrets set --env-file .env.production.local
```

The coach function requires `ANTHROPIC_API_KEY`.

### 3. Enable Auth

In Supabase dashboard:
- Go to **Authentication → Providers**
- Enable **Email** (magic link or password)
- Configure email templates as needed

## Deployment

### Vercel (PWA Hosting)

```bash
npm run build
```

Deploy to Vercel:
- Connect your GitHub repo
- Set environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Deploy

The PWA will be installable on all platforms.

## Architecture Overview

```
┌─────────────────┐
│   React PWA     │  ← Client-side app
│  (Vite + TS)    │     (Offline-capable)
│                 │
│ • Screens       │
│ • Scoring       │
│ • Leaderboard   │
│ • Offline queue │
└────────┬────────┘
         │
         ├─────────────────────────┐
         │                         │
    ┌────▼─────┐          ┌───────▼──────┐
    │ Supabase │          │  IndexedDB   │
    │ Postgres │          │ (local queue)│
    │          │          │              │
    │ • Auth   │          │ • Events     │
    │ • Events │          │ • Baseline   │
    │ • Ledger │          │ • Competitors│
    └────┬─────┘          └──────────────┘
         │
    ┌────▼──────────┐
    │ Edge Function │
    │ (Coach)       │
    │               │
    │ • Queries RLS │
    │ • Calls Claude│
    │ • Returns     │
    │   coaching    │
    └───────────────┘
```

## Key Design Decisions

**Append-only ledger:** Events are never edited/deleted, only voided and corrected. This ensures:
- Leaderboards are always reproducible from raw data
- Full audit trail
- RLS enforces append-only at the DB level

**Offline-first:** Events queue locally (IndexedDB) and sync when online. Coach is online-only.

**Scoring module:** Single source of truth used by both client (instant feedback) and Edge Function (authoritative).

**Competitors:** Generated once at session start and snapshotted. Past leaderboards never change.

## Testing

Run scoring tests to verify Navy table accuracy:

```bash
npm test
```

Tests verify:
- Threshold scoring
- Interpolation between thresholds
- Example from PRD (38 push-ups, 2:02 plank, 8:50 row → score 70)
- Monotonicity (higher reps/faster times = higher scores)

## Troubleshooting

### "Missing Supabase environment variables"
Check `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

### "Coach calls fail"
- Verify Edge Function is deployed
- Check `ANTHROPIC_API_KEY` is set in Edge Function secrets
- Check user is authenticated (has valid JWT)

### "Events not syncing"
- Check browser DevTools → Application → IndexedDB for queued events
- Verify `navigator.onLine` status
- Check network tab for failed Supabase requests

### "Leaderboard incorrect"
- Run `npm test` to verify scoring module
- Check that corrections use void + new event pattern
- Verify RLS policies are applied (test in SQL editor)

## Next Steps (Post-V1)

- Live PM5 Bluetooth telemetry (requires native Expo build)
- Supabase Realtime for second-screen coaching (e.g., tablet during row)
- User-selectable Ghost You (best session or specific prior session)
- Bike event support
- Performance trends and analytics
