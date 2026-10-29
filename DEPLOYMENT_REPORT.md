# PRT Deployment Report

## ✅ Code Review & Build Verification

**Commit:** `9c2dcfa` (Merge: PRT correctness recovery)  
**Tests:** 65 pass ✓ (includes PostgreSQL/RLS and offline recovery)  
**Build:** Successful ✓ (396.80 kB JS, 2.79 kB CSS gzipped, PWA 10 entries)

### Changes Merged
- Fixed migration 002 (invalid OLD reference in RLS policy)
- Added forward repair migration 003
- Shared scoring/leaderboard code in `supabase/functions/_shared/`
- Session reload recovery and interrupted sync handling
- Coach CORS with RLS-based caller queries
- PWA icons (192px, 512px, SVG)
- 65 regression tests (scoring, RLS, offline, async)

---

## 📋 Remaining Deployment Tasks

### 1. Database Migrations (Supabase)

**Current migrations ready:**
- `001_init_prt.sql` — Already applied (do NOT rerun)
- `002_allow_session_completion.sql` — Corrected, run if not applied
- `003_repair_session_completion.sql` — Forward repair, safe to reapply

**Action:**
1. Inspect Supabase migration history in Settings → SQL Editor
2. If 002 is recorded: Apply 003 only
3. If 002 is NOT recorded: Apply 002, then 003
4. Never rerun 001 (it will fail on existing tables)

**What they do:**
- 002/003: Allow authenticated users to complete their own in_progress sessions
- Requires 3 persisted non-voided results (including zero scores)
- Prevents reopening completed sessions or changing snapshots/seeds

### 2. Coach Edge Function Redeploy

**Source code:** `supabase/functions/coach/index.ts`  
**Dependencies:** `supabase/functions/_shared/*` (scoring, leaderboard, types)

**Action:**
```bash
supabase functions deploy coach --project-id <PROJECT_ID>
```

**Requires:**
- SUPABASE_URL: Environment variable (auto-supplied)
- SUPABASE_ANON_KEY: Publishable key (auto-supplied)
- ANTHROPIC_API_KEY: Set in Supabase Secrets (if coaching enabled)
- COACH_ALLOWED_ORIGINS: Optional in Secrets (default: https://prt-brown-eta.vercel.app)
- ANTHROPIC_MODEL: Optional in Secrets (default: claude-3-5-sonnet-20241022)

**Verification:**
- OPTIONS preflight includes CORS headers
- Real Anthropic API call succeeds with actual model
- Unauthorized calls still get CORS headers

### 3. Frontend Redeploy (Vercel)

**Source:** Merged main branch  
**Environment Variables (Verify in Vercel):**
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

**Action:**
- Vercel auto-deploys on push to main (if webhook connected)
- Or manually trigger redeploy in Vercel dashboard

**Verify:**
- PWA manifest has icons (icon-192.png, icon-512.png, icon.svg)
- Service worker precaches 10 entries
- Mobile layout: safe-area-inset padding applied

---

## 🧪 Live Verification Checklist

Use a test account. Preserve existing workout history.

### Scoring Correctness
- [ ] Push-ups 38, plank 2:02, row 8:50 → scores 70/70/70, overall 70
- [ ] Row 9:31 (invalid, >9:30 max) scores proportionally, not zero
- [ ] User + opponent both average zero events equally

### Session Recovery
- [ ] Online: Start session, confirm event, log 2nd event
- [ ] Offline: Reload/reopen → score/reveals/input stage recover
- [ ] Offline: Log 3rd event, reconnect → all UUIDs upload once

### Upload Resilience
- [ ] Interrupt upload → retries on next sync
- [ ] Failed upload → badge visible, Save blocked until persisted

### Session Completion
- [ ] All 3 events logged → Save enabled
- [ ] Complete session → state='completed', completed_at set in Supabase
- [ ] Immutable fields unchanged (user_id, competitor_seed, snapshots)
- [ ] Cannot reopen completed session

### Post-Completion
- [ ] Next Saturday PRT session baseline uses real completed results
- [ ] Ghost You populated from real prior session
- [ ] Practice session history visible and read-only

### Mobile Experience (iPhone/Safari)
- [ ] PWA installation: icon appears on home screen
- [ ] Safe areas: padding around notch/home indicator
- [ ] Numeric input: accepts digits and colon (2:02 format)
- [ ] Leaderboard: 3-column layout readable at 375px
- [ ] Reload recovery: all state restores

### Coach
- [ ] Authenticated "Coach Me" call succeeds
- [ ] Coaching response appears
- [ ] Unauthorized call returns 401 + CORS headers
- [ ] OPTIONS preflight succeeds

### Multi-User Isolation
- [ ] User B cannot read User A's sessions/events
- [ ] User B cannot complete User A's sessions

---

## 🚀 Deployment Sequence

1. **Apply Supabase migrations 002/003** (database changes)
2. **Deploy coach function** (requires Anthropic secrets)
3. **Deploy frontend to Vercel** (auto-deploy if webhook active)
4. **Run verification checklist** (live against deployed services)

---

## ⚠️ Important Notes

- **No data loss:** Migrations and code changes preserve all workout history
- **Backward compatible:** Existing competitor snapshots unchanged
- **RLS enforced:** All queries use authenticated user context
- **Secrets:** ANTHROPIC_API_KEY must be in Supabase Secrets, not Git
- **No hardcoded credentials:** Coach function uses Supabase-provided SUPABASE_URL/key

---

## Ready for Deployment
✅ Code: Merged and tested  
⏳ Database: Awaiting migration application  
⏳ Coach: Awaiting Anthropic secrets and function redeploy  
⏳ Frontend: Awaiting Vercel redeploy

