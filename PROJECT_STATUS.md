# PRT Virtual Gym — Project Status & Overview

**Last Updated:** October 29, 2026  
**Status:** ✅ Production Ready  
**Live:** https://prt-brown-eta.vercel.app/

---

## What Is This?

A **Progressive Web App (PWA)** for logging U.S. Navy Physical Readiness Test (PRT) results and competing against AI-generated opponent profiles. Users log three fitness events (push-ups, forearm plank, 2km row), get instant scoring, see a live leaderboard with simulated competitors, and receive real-time AI coaching.

**Key insight:** Results are stored once in an immutable append-only ledger. All scores, rankings, and leaderboards are *derived* from this single source of truth — never edited, only appended.

---

## Why This Project?

**Problem:** Earlier virtual gym apps had point inflation, corrections bleeding through, unreproducible leaderboards.

**Solution:** One immutable ledger, one scoring module, no edit/delete operations. Everything is auditable.

**User:** One person (you) doing weekly PRT sessions. The app tracks progress, generates realistic competitors seeded from your baseline performance, and coaches you through each session.

---

## Live Deployment

| Service | URL | Status |
|---------|-----|--------|
| **Frontend (PWA)** | https://prt-brown-eta.vercel.app/ | ✅ Live |
| **Backend (Supabase)** | urewfzuyzgzsocmesfga.supabase.co | ✅ Configured |
| **AI Coaching** | Supabase Edge Function | ⏳ Requires API key |
| **GitHub** | https://github.com/greenhill32/PRT | ✅ Synced |

---

## Architecture at a Glance

```
Frontend (Vercel)
  ├─ React 18 + TypeScript
  ├─ Vite build
  ├─ IndexedDB (offline queue)
  └─ PWA service worker

Backend (Supabase)
  ├─ PostgreSQL (append-only ledger)
  ├─ Row Level Security (RLS)
  ├─ Auth (email signup/signin)
  └─ Edge Function (coaching API)

AI (Anthropic)
  └─ Claude Opus (coaching only)
```

---

## Core Data Model

**Two tables:**

1. **`sessions`** — One row per PRT attempt
   - User-owned (RLS enforces)
   - Stores baseline and competitor snapshots
   - State: `in_progress` → `completed`

2. **`events`** (append-only ledger) — One row per result entry
   - User-owned (RLS enforces)
   - Can be voided (not deleted) via `void` event type
   - Never edited or deleted (RLS prevents UPDATE/DELETE)

**Example flow:**
- User logs 40 push-ups → INSERT event (event_1)
- User logs 2:30 plank → INSERT event (event_2)
- User corrects push-ups to 38 → INSERT void event pointing to event_1, then INSERT corrected event (event_3)

Leaderboard is computed from the latest non-voided event per event type.

---

## How It Works (User Journey)

1. **Sign up** with email via Supabase Auth
2. **Start Session** (Saturday PRT or practice)
   - App fetches prior 5 completed sessions
   - Generates baseline (median scores from history)
   - Seeds 5 competitors from baseline (Peer, Steady, Volatile, Rival, Ghost You)
   - Snapshot is saved with session (immutable)
3. **Log events** in order:
   - Enter push-ups (reps) → Confirm → competitors' push-ups revealed
   - Enter plank (mm:ss or seconds) → Confirm → competitors' plank revealed
   - Enter 2k row (mm:ss or seconds) → Confirm → leaderboard final
4. **View score** and ranking vs. simulated competitors
5. **Ask Coach** for feedback or advice (optional, requires ANTHROPIC_API_KEY)
6. **Save session** → becomes baseline for next week

---

## Scoring System

**Navy PRT scoring tables** (Age 55–59 male):

| Event | Min | Max | Better Is |
|-------|-----|-----|-----------|
| Push-ups | 16 reps (60 pts) | 60 reps (100 pts) | More |
| Plank | 1:27 (60 pts) | 2:54 (100 pts) | Longer |
| 2km Row | 9:30 (60 pts) | 7:40 (100 pts) | Faster |

**Composite Score:** Arithmetic mean of three events, clamped 0–100.

**Tiers:**
- Outstanding: 100
- Excellent: 85–99
- Good: 70–84
- Satisfactory: 60–69
- Does Not Meet Standards: 0–59

---

## Key Technical Decisions

### 1. Append-Only Ledger
✅ **Why:** Immutable history, auditability, reproducible leaderboards.
❌ **Alternative:** Edit/delete operations → point inflation, unclear truth.

### 2. RLS (Row Level Security)
✅ **Why:** Users can only access their own sessions/events. Enforced at database level, not app logic.
❌ **Alternative:** Trust app to check permissions → security hole.

### 3. Competitor Snapshot
✅ **Why:** Competitors generated once at session start, never change. Past leaderboards are unchanging.
❌ **Alternative:** Generate on-the-fly → leaderboard changes retroactively as you log new results.

### 4. Offline-Capable
✅ **Why:** Gym wifi drops. App queues results locally, syncs when online.
❌ **Alternative:** Require internet → session lost if connection drops.

### 5. Single Scoring Module
✅ **Why:** Client and server both use same logic, tested together.
❌ **Alternative:** Separate implementations → drift, different scores on client vs. server.

### 6. Coach is Optional
✅ **Why:** Coaching is nice-to-have. Session works without it.
❌ **Alternative:** Required → app breaks if API key missing.

---

## Offline Capability

**What works offline:**
- Browse past sessions
- View stored competitors/baseline
- Log results to IndexedDB queue
- Calculate local score

**What requires internet:**
- Sign in/sign up
- Save session to Supabase
- Sync queued results
- Ask Coach

**Auto-sync:** When online, queued events sync to Supabase via background sync API.

---

## Deployment Checklist

### Already Done ✅
- ✅ Supabase project created
- ✅ Migration run (`001_init_prt.sql`)
- ✅ Auth configured (email provider)
- ✅ Vercel deployed (auto-redeploy on push)
- ✅ PWA manifest configured
- ✅ Service worker generated
- ✅ Environment variables set (Supabase URL + key)

### Still Needed (Optional)
- ⏳ Anthropic API key → `supabase secrets set ANTHROPIC_API_KEY=sk_...`
- ⏳ Custom domain (currently vercel.app subdomain)

---

## Environment Variables

### Frontend (Vercel)
Required in Vercel Settings → Environment Variables:
```
VITE_SUPABASE_URL=https://urewfzuyzgzsocmesfga.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_8FyjufBJUBah5W0veX8iRA_mm2SSQYI
```

### Backend (Supabase Secrets)
Optional, for coaching:
```
ANTHROPIC_API_KEY=sk_... (set via: supabase secrets set ANTHROPIC_API_KEY=sk_...)
```

---

## How to Work on This

### Setup
```bash
cd ~/Documents/Projects/PRT
npm install
npm run dev
```

Opens http://localhost:5173

### Test
```bash
npm test           # Run all tests (26 tests in scoring module)
npm test -- --run # Run once and exit (CI mode)
```

### Build
```bash
npm run build      # TypeScript + Vite → dist/
npm run preview    # Test production build locally
```

### Commit & Push
```bash
git add .
git commit -m "Your message"
git push origin main
```

Vercel auto-deploys on push.

### Debug
- **Frontend:** Browser DevTools (F12) → Console tab
- **Backend:** Supabase Dashboard → SQL Editor (test queries)
- **Auth:** Supabase Dashboard → Authentication → Users
- **Data:** Supabase Dashboard → Table Editor → sessions/events

---

## Code Structure

```
src/
├── main.tsx              # Vite entry
├── App.tsx               # Root component
├── index.css             # Global styles (iOS safe-area aware)
├── scoring.ts            # Navy scoring tables + logic (source of truth)
├── scoring.test.ts       # 26 tests validating Navy tables
├── supabase.ts           # Database client + RLS-aware queries
├── competitors.ts        # Seeded PRNG for opponent generation
├── leaderboard.ts        # Leaderboard compute + reveal logic
├── queue.ts              # IndexedDB queue for offline sync
├── sync.ts               # Background sync to Supabase
├── types.ts              # TypeScript interfaces
└── screens/
    ├── AuthScreen.tsx    # Sign up / sign in
    ├── HomeScreen.tsx    # Past sessions + start new
    └── SessionScreen.tsx # Main PRT logging UI

styles/
├── SessionScreen.css     # Mobile-first (card leaderboard, 15px text)
├── HomeScreen.css        # Session list + start buttons
├── AuthScreen.css        # Login form

supabase/
├── migrations/
│   └── 001_init_prt.sql  # Schema + RLS policies
└── functions/
    └── coach/
        └── index.ts      # Edge Function (Claude Opus coaching)
```

---

## Mobile-First UX (Oct 29, 2026)

**Redesigned for iPhone (375–430px):**
- ✅ iOS safe-area padding (notch/home indicator)
- ✅ `100dvh` instead of `100vh` (Safari fix)
- ✅ Vertical stack: entry → score → leaderboard → coach
- ✅ Large inputs (16px font, 52px buttons)
- ✅ Card-based leaderboard (15px text, not 9px)
- ✅ Responsive at 3 breakpoints: mobile / tablet / desktop

**Preserves desktop:** ≥900px reverts to 2-column dashboard.

---

## Recent Changes (October 29, 2026)

| Commit | What Changed |
|--------|--------------|
| *(latest)* | **Fix session completion lifecycle** (migration 002: allow session UPDATE for completion while keeping events append-only) |
| `51093dd` | iPhone-first layout redesign (card leaderboard, safe-area, vertical stack) |
| `76b30b8` | Remove compiled .js files from tracking |
| `5241ba5` | Time input: accept "2:02" or "122" format |
| `58f1e92` | Remove .js files |
| `3c03a1f` | Fix RLS: explicitly set user_id in createSession |
| `bccfb85` | Finalize deployment checks (tests, build, Supabase ready) |
| `6f23b6d` | Prepare for production (package-lock.json, scoring fix) |

---

## Testing & Quality

✅ **Tests:** 26 passing (Navy scoring tables, interpolation, monotonicity, edge cases)  
✅ **Build:** TypeScript strict mode, Vite bundling, PWA manifest  
✅ **Code:** No console errors, no network failures in happy path  
✅ **Deployment:** Vercel auto-builds on main, GitHub synced  

---

## Next Steps (If Returning in 6 Months)

1. **Check deployment:** https://prt-brown-eta.vercel.app/ (live?)
2. **Check logs:** Vercel dashboard → Deployments → Logs
3. **Test locally:** `npm install && npm run dev`
4. **Check data:** Supabase Dashboard → Table Editor
5. **Run tests:** `npm test` (all 26 should pass)
6. **Review commits:** `git log --oneline -20` (what changed?)

---

## Contacts & Credentials

- **GitHub:** greenhill32 / PRT repo
- **Vercel:** Connected to GitHub (auto-deploy main)
- **Supabase:** urewfzuyzgzsocmesfga (Project ID in URL)
- **Anthropic:** API key in Supabase secrets (optional)

---

## Known Limitations

- **Sharing:** Designed as a personal app. Authentication and RLS isolate each user completely via Row Level Security. There are no shared leaderboards, friends, teams, or cross-user competition features. Each user has independent sessions, baselines, and competitors.
- **Events:** Only 3 events per session (push-ups, plank, row). Adding more requires schema + UI changes.
- **Competitors:** Fixed 5 archetypes (Peer, Steady, Volatile, Rival, Ghost You). Customization needs seeding logic.
- **Coach:** Optional. Requires ANTHROPIC_API_KEY. No conversation history (stateless).
- **Mobile:** Optimized for iPhone. Android should work but untested.

---

## Questions to Revisit in 6 Months

- [ ] Has the app been used regularly? (Check session history)
- [ ] Are scores accurate? (Spot-check against Navy tables)
- [ ] Did any tests break? (Run `npm test`)
- [ ] Any breaking changes in dependencies? (npm outdated)
- [ ] Anthropic API key expired or rate-limited? (Check logs)
- [ ] Vercel deployment still working? (Test live URL)

---

## One-Line Summary

**A private, offline-capable PWA for logging Navy PRT results, computing scores from immutable ledgers, racing seeded AI competitors, and getting coaching feedback—built with React, Supabase, and Anthropic.**

---

**Build date:** Oct 29, 2026  
**Last deployed:** Oct 29, 2026 (commit `51093dd`)  
**Next review:** ~May 2027
