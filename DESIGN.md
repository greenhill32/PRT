# PRT Virtual Gym — V1 Design Deliverables

**Status:** Design phase — no code written yet. Stop here for review before proceeding to Step 2 (build).

---

## 1. Supabase Schema & RLS

### Tables

#### `sessions`
```sql
CREATE TABLE sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'saturday_prt' CHECK (kind IN ('saturday_prt', 'practice')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  scoring_version TEXT NOT NULL DEFAULT '1.0',
  competitor_model_version TEXT NOT NULL DEFAULT '1.0',
  competitor_seed INT NOT NULL, -- deterministic PRNG seed
  baseline_snapshot JSONB, -- {pushups_median, plank_median_sec, row_median_sec}
  competitor_snapshot JSONB NOT NULL, -- {peer, steady, volatile, rival, ghost_you}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_kind ON sessions(kind) WHERE kind = 'saturday_prt';
```

#### `events` (append-only ledger)
```sql
CREATE TABLE events (
  event_id UUID PRIMARY KEY, -- client-generated, enables idempotent retries
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('pushups', 'plank', 'row_2k', 'bike', 'void')),
  raw_value INT, -- reps for pushups, seconds for plank/row (NULL on void rows)
  unit TEXT CHECK (unit IN ('reps', 's')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL, -- client time of confirmation
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'pm5')),
  correction_of UUID REFERENCES events(event_id), -- if this corrects a prior row
  voids_event_id UUID REFERENCES events(event_id), -- if this is a void marker
  detail JSONB, -- {avg_500m_split_sec?, stroke_rate?} for row only
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_voids ON events(voids_event_id) WHERE voids_event_id IS NOT NULL;
```

### Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- sessions: users can insert/select their own rows only
CREATE POLICY sessions_insert ON sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY sessions_select ON sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sessions_update ON sessions FOR UPDATE USING (false); -- no updates
CREATE POLICY sessions_delete ON sessions FOR DELETE USING (false); -- no deletes

-- events: users can insert/select their own session's rows only
CREATE POLICY events_insert ON events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM sessions WHERE sessions.session_id = events.session_id AND sessions.user_id = auth.uid())
);
CREATE POLICY events_select ON events FOR SELECT USING (
  EXISTS (SELECT 1 FROM sessions WHERE sessions.session_id = events.session_id AND sessions.user_id = auth.uid())
);
CREATE POLICY events_update ON events FOR UPDATE USING (false); -- no updates
CREATE POLICY events_delete ON events FOR DELETE USING (false); -- no deletes
```

### Key Design Points
- **Append-only enforcement:** No UPDATE or DELETE policies on events table
- **event_id is client-generated UUID:** Enables idempotent retries; the client generates it, server doesn't
- **session_id NOT NULL:** Every event belongs to a session
- **Corrections:** append a void row pointing to the old event_id, then append a new row with corrected value
- **RLS via JWT:** All reads/writes filtered by auth.uid()

---

## 2. Ledger Design (Void & Correction Handling)

### Correction Flow

When a user corrects a result (e.g., entered 38 push-ups, meant to enter 40):

1. Client generates new event_id (UUID) for the correction
2. Append void row: `{event_id, session_id, event_type: 'pushups', raw_value: null, unit: null, voids_event_id: <original_event_id>}`
3. Append corrected row: `{event_id: <new_uuid>, session_id, event_type: 'pushups', raw_value: 40, ...}`
4. Both rows queue locally if offline; sync on reconnect
5. Server processes both rows (idempotent by UUID)

### Effective Result Calculation

When recomputing the leaderboard from raw rows, for each event_type per session:
1. Collect all non-void rows of that event_type
2. Find the latest non-void event (by created_at)
3. Use its raw_value as the effective result
4. Ignore all earlier entries for that event_type

**Test:** Recomputing from raw ledger rows must equal the displayed leaderboard.

### Why This Works
- No edit/delete operations needed
- Corrections are auditable (both the void and the replacement are visible)
- Retries are idempotent (if a row with event_id already exists, INSERT fails silently)
- History is preserved for reporting/debugging

---

## 3. Scoring Module Structure

### Interface

```typescript
// src/scoring.ts
export interface ScoringContext {
  version: string; // e.g. "1.0" for Navy 55-59 male
  thresholds: {
    pushups: [reps: number, score: number][];
    plank: [seconds: number, score: number][];
    row2k: [seconds: number, score: number][];
  };
  categories: { min: number; max: number; label: string }[];
}

export function eventPoints(
  eventType: 'pushups' | 'plank' | 'row_2k',
  rawValue: number,
  context: ScoringContext
): number;

export function composite(
  results: { pushups?: number; plank?: number; row_2k?: number },
  context: ScoringContext
): number;

export function tierOf(
  score: number,
  context: ScoringContext
): { category: string; nextTier: string; pointsToNext: number };

export function gapToNextTier(
  score: number,
  eventType: 'pushups' | 'plank' | 'row_2k',
  context: ScoringContext
): { pointGap: number; rawValueNeeded: number };

export const scoringVersions: Record<string, ScoringContext> = {
  '1.0': { /* Navy 55-59 male */ }
};
```

### Scoring Logic

**Event scoring (with interpolation):**
1. For push-ups: higher value → higher score (unbounded)
2. For plank & row: lower time → higher score
3. Between thresholds: linear interpolation
4. Cap at 100 points
5. Below 60-point minimum: extrapolate or clamp to 0

**Composite:** Arithmetic mean of the three confirmed event scores

**Category mapping:** Outstanding (100) / Excellent (85–99) / Good (70–84) / Satisfactory (60–69) / Does Not Meet Standards (< 60)

### Implementation Notes
- Single shared module, used by both client and Edge Function
- All scoring data is deterministic (no random elements)
- Versioning allows scoring rule changes without rewriting history
- Tests must verify interpolation accuracy between thresholds

---

## 4. Competitor Generation Algorithm

### Baseline Calculation

Baseline = median of the last 3–5 completed `saturday_prt` sessions (practice sessions excluded).

For each event:
- `baseline_pushups = median([past_session_1.pushups, past_session_2.pushups, ...])`
- `baseline_plank_sec = median([past_session_1.plank_sec, ...])`
- `baseline_row_sec = median([past_session_1.row_sec, ...])`

**Cold start:** If fewer than 3 prior sessions, use tier-based defaults:
- Push-ups: 30 (score ~65)
- Plank: 1:30 (score ~65)
- 2k row: 9:30 (score ~60)

### Generation Algorithm

For each competitor (Peer, Steady, Volatile, Rival, Ghost You):

1. Seed a deterministic PRNG: `PRNG(competitor_seed + competitor_id)`
2. Draw one session form value (a good/bad day multiplier): `form = PRNG() * [session_form_variance]`
3. For each event, draw per-event noise: `noise = PRNG() * [per_event_noise_variance]`
4. Calculate raw ability:
   ```
   ability = baseline * (1 + form * form_weight + noise * noise_weight)
   ```
5. Convert to result:
   - Push-ups: bounded count, cap at ~100
   - Plank & row: log-normal distribution (right-skewed, positive)
6. Store the full set in `competitor_snapshot`

### Competitor Personas

| Competitor | Ability Offset        | Form Variance | Noise Variance |
|------------|----------------------|---------------|----------------|
| Peer       | baseline (1.0x)      | Medium (±0.1) | Medium (±0.1)  |
| Steady     | baseline (1.0x)      | Low (±0.05)   | Low (±0.05)    |
| Volatile   | baseline (1.0x)      | High (±0.2)   | High (±0.2)    |
| Rival      | baseline * 1.35–1.5x | Medium (±0.1) | Medium (±0.1)  |
| Ghost You  | Best prior session or PB | 0 (fixed)   | 0 (fixed)      |

### Reveal Rule
- All values exist from the start but stay hidden
- A competitor's result for an event is revealed **only after** the user confirms that event
- Coach never receives unrevealed values

---

## 5. Session & Reveal State Machine

### Session States
```
INITIAL
  ↓
STARTED (user confirms session start)
  ↓
EVENT_1_PENDING (push-ups entry panel open)
  ↓ (user confirms push-ups)
EVENT_1_REVEALED (peer/steady/volatile/rival push-ups displayed)
  ↓
EVENT_2_PENDING (plank entry panel open)
  ↓ (user confirms plank)
EVENT_2_REVEALED (peer/steady/volatile/rival plank displayed)
  ↓
EVENT_3_PENDING (row entry panel open)
  ↓ (user confirms row)
EVENT_3_REVEALED → LEADERBOARD_FINAL (full leaderboard displayed, can coach)
  ↓
COMPLETED (user saves session)
```

### Leaderboard Modes
- **Provisional:** After event 1 or 2 confirmed (partial results, updating)
- **Final:** After all required events confirmed

### Reveal Gate Logic

In the UI, render competitor rows conditionally:

```typescript
if (competitorSnapshot[competitorName]) {
  const revealedEvent = revealedEvents.has(eventType);
  if (revealedEvent) {
    return competitorSnapshot[competitorName][eventType]; // display value
  } else {
    return null; // blank cell
  }
}
```

### Corrections

When user taps "Correct" on a confirmed event:

1. UI opens entry panel for that event again
2. User enters the new value
3. On confirmation:
   - Append void row pointing to the old event_id
   - Append new row with corrected raw_value
   - Leaderboard recalculates (old event is now void)
   - Unrevealed competitors remain hidden until they're re-revealed (if at all)

---

## 6. Coach Context Contract

### POST /coach Endpoint

**Request:**
```json
{
  "session_id": "uuid",
  "question": "My row was 9:07 and I faded badly near the end. What should I change?"
}
```

**Edge Function behavior:**
1. Verify caller with Supabase Auth JWT
2. Query sessions & events tables as the authenticated user (RLS applies)
3. Build context object from confirmed events and revealed competitors only
4. Send context + optional question to Anthropic API
5. Return text response

### Context Object (sent to the model)

```typescript
{
  confirmed_results: {
    pushups: { raw_value: 38, points: 70 },
    plank: { raw_value: 122, points: 70 },
    row_2k: { raw_value: 530, points: 70 } // seconds
  },
  pending_events: ['bike'], // or empty
  provisional_score: 70,
  category: 'Good',
  points_to_next_tier: 120, // to reach 80
  cheapest_improvement: {
    event: 'plank',
    raw_value_needed: 136, // to score 80
    gain: 10
  },
  revealed_leaderboard: [
    { rank: 1, name: 'You', score: 70 },
    { rank: 2, name: 'Rival', score: 72 },
    { rank: 3, name: 'Peer', score: 70 },
    { rank: 4, name: 'Steady', score: 68 },
    { rank: 5, name: 'Volatile', score: 68 },
    { rank: 6, name: 'Ghost You', score: 76 }
  ],
  recent_sessions: [
    { date: '2026-10-28', score: 68, category: 'Good' },
    { date: '2026-10-21', score: 72, category: 'Good' }
  ],
  pbs: {
    pushups: 40,
    plank: 127,
    row_2k: 515
  },
  trend: 'improving', // or 'stable', 'declining'
  row_detail: {
    avg_500m_split: 125,
    stroke_rate: 28
  }
}
```

### AI Behavior

- **Coach Me (no question):** Return the single most useful short piece of advice for the current state
- **Ask Coach (free-text question):** Answer the user's question using the same context
- **Never:** Calculate authoritative scores, decide leaderboard positions, generate canonical competitor results, or rewrite history
- **Only:** Interpret facts, offer coaching, answer questions

---

## 7. PWA Screen Flow

### Screens

#### 1. Auth Screen
- **When:** On first sign-in or after logout
- **Elements:** Email input, password input or magic-link button, sign-up / sign-in toggle
- **On success:** Redirect to Home screen, start session if needed

#### 2. Home Screen
- **When:** Session not started, or after session completed
- **Elements:** 
  - "Start Saturday PRT" button (starts a new session)
  - "Start Practice Session" button (no competitors, no leaderboard)
  - Recent sessions list (date, score, category)
  - Personal PBs (push-ups, plank, row)
- **On start session:** Generate competitors, seed PRNG, cache baseline, redirect to session screen

#### 3. Session Screen (the main loop)
One screen carries the entire session. Displays:

**Top section:**
- Session progress: "Push-ups → Plank → Row" with done/current/pending icons
- Current event: which event is being entered
- Correction link on each confirmed event

**Middle section (entry panel):**
- Event name & icon
- Input field (number for push-ups, time picker for plank/row, optional row detail)
- "Confirm" button
- Undo/cancel

**Leaderboard (focal element):**
- 6 rows: You, Peer, Steady, Volatile, Rival, Ghost You
- 4 columns: Name, push-ups score/result, plank score/result, row score/result
- Unrevealed cells are blank
- Current tier display: "Good" with points to next tier
- Rows animate to new positions as results update

**Coach panel (below leaderboard):**
- "Coach Me" button (auto-advice)
- "Ask Coach" text input + send button
- Coach response rendered as text

**Collapsed "Debug" section:**
- Full ledger (all events, voids, timestamps)
- Coach context (the exact facts sent to the model)
- Session state machine (current state, reveal gate)

#### 4. Post-Session Screen
- **When:** All required events confirmed
- **Elements:**
  - Final score & category
  - Leaderboard (full)
  - "Save Session" button
  - Option to continue coaching or corrections
- **On save:** Mark session as completed, update user's baseline, redirect to Home

### Navigation

- Home → Start Session → Session Screen
- Session Screen → Corrections (inline)
- Session Screen → Post-Session Screen (on completion)
- Post-Session → Home (on save)

---

## 8. Offline Sync Strategy

### Local Queue (IndexedDB)

Store pending events in a queue:
```typescript
interface QueuedEvent {
  event_id: UUID;
  session_id: UUID;
  event_type: string;
  raw_value: number | null;
  unit: string;
  timestamp: ISO8601;
  source: 'app';
  status: 'queued' | 'syncing' | 'synced' | 'error';
  error?: string;
}
```

### Offline Confirmation

1. User enters push-ups, taps confirm
2. Generate event_id (UUID) client-side
3. Write to IndexedDB queue: `{event_id, ..., status: 'queued'}`
4. UI updates immediately from local state
5. Session header shows "3 unsynced results"

### Background Sync

1. On reconnect (or periodic check), start sync loop
2. Fetch all `status: 'queued'` rows from IndexedDB
3. Batch insert into Supabase `events` table (UUID as primary key)
4. On success: update status to `'synced'`
5. On failure: update status to `'error'` + save error message
6. On duplicate (already exists): treat as success
7. Re-sync on reconnect, with exponential backoff

### Competitor Snapshot & Baseline

- At session start, fetch baseline & cache in IndexedDB
- Fetch competitor snapshot & cache locally
- If offline for session start: use last cached baseline
- Avoid network round-trips during event entry

### Coach Availability

- Coach calls require online connection
- If offline, show "Coach unavailable (offline)" in UI
- Do not queue coach requests; users can ask again when online

### Test

After sync completes, verify:
- All queued events are now in Supabase
- Recomputing the leaderboard from Supabase ledger equals the UI's local state
- No duplicates created (idempotent by event_id)

---

## Open Decisions (Ready for Review)

1. ✅ **Scoring tables:** Navy 55–59 male confirmed
2. ✅ **Composite formula:** Arithmetic mean of three event scores confirmed
3. **Cold-start defaults:** Tier-based defaults at 65/65/60 — confirm acceptable?
4. **Ghost You:** Always the best session, or allow user to select? (Recommend: always best, for now)
5. **Rival tuning:** 0.35 SD better than baseline — test after a few real sessions
6. **Bike event:** Optional, leave for later?

---

## Next Steps

This design is ready for review. Once approved:

1. Proceed to Step 2 (build)
2. Build in this order: scoring + tests → ledger + RLS → recomputation test → competitors + reveal → session screen + queue → auth + coach
3. Keep narrow; no features outside SPEC.md

