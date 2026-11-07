# Importing a workout recorded outside the app

Covers the 7 November 2026 Saturday PRT. The importer is `scripts/import-workout.ts`,
with planning logic in `src/workoutImport.ts` and data in `scripts/data/2026-11-07.workout.json`.

## What gets written

One `sessions` row and one `events` row per result. All rows are inserted; none are
updated or deleted.

| Source | Stored as | Notes |
| --- | --- | --- |
| Push-ups 50 in 2 min | `pushups`, 50 reps | Scored normally. |
| Forearm plank 80 s | `plank`, 80 s | Scored normally. |
| Row 2,000m 653 s (10:53) | `row_2k`, 653 s, `detail.notes` = "1 pause…" | The pause is a text note. It is not a scored field. |
| Lat pulldown 32 kg, 2×4 | `accessory`, 8 reps total, `detail` = exercise, load, sets, reps per set, tempo | New event type (migration 004). |
| Incline chest press 20 kg, 1×4 | `accessory`, 4 reps total | Separate event because the load differs. |
| Incline chest press 25 kg, 1×4 | `accessory`, 4 reps total | |

The session is `saturday_prt`, `state` `completed`, with `competitor_snapshot` `{}`.
Competitors for that day cannot be reconstructed, so none are recorded. The app
already handles an empty snapshot.

## Decisions to confirm before executing

1. **Time of day.** You gave a date only. Events are placed at 12:00 UTC (plank +10
   min, row +20 min, accessories +30 min onward) as placeholders. Correct the
   `start_time_utc` field in the data file if you know the real time. Ordering is the
   only thing it affects, and the scores do not depend on it.
2. **Session kind.** Imported as `saturday_prt`, which feeds baselines, the league and
   progress. Change `kind` in `src/workoutImport.ts` to `practice` if you do not want
   it counted.
3. **Competitor snapshot.** Empty, as described above.

## Safety checks built into the importer

- Refuses to run unless `SUPABASE_URL` matches `EXPECTED_PROJECT_REF`.
- Signs in with the owning account and refuses unless its user ID equals
  `EXPECTED_USER_ID`.
- Aborts if another Saturday session already exists on that date, or if the target
  session has events the import does not expect.
- IDs are deterministic UUIDv5 values derived from the user, date and item. A re-run
  matches existing rows and writes nothing new. Existing rows with different data abort the run.
- Dry run is the default. Nothing is written without `-- --execute`.
- After writing, it reads the rows back and compares them with the plan.

## Procedure

1. Apply migration 004 (`supabase/migrations/004_accessory_events.sql`) in the
   Supabase SQL editor, or with `supabase db push` if the CLI migration history is
   in sync. It is additive and can be re-run. Check first that migrations 001–003 are
   already applied.
2. Find your user ID: Authentication → Users in the Supabase dashboard.
3. Dry run. Set the values in your shell only, not in a file:

   ```bash
   export SUPABASE_URL=https://urewfzuyzgzsocmesfga.supabase.co
   export SUPABASE_PUBLISHABLE_KEY=...        # publishable key only
   export EXPECTED_PROJECT_REF=urewfzuyzgzsocmesfga
   export IMPORT_EMAIL=...                    # the account that owns the history
   export IMPORT_PASSWORD=...
   export EXPECTED_USER_ID=...                # from step 2
   npx vite-node scripts/import-workout.ts
   ```

   Review the printed plan: the verified user, the session action, and each event
   with `insert` or `already-present`. On a first run expect the session and six
   event lines (push-ups, plank, row, three accessories) marked `insert`.
4. Execute: `npx vite-node scripts/import-workout.ts -- --execute`.
5. Run it a second time. Every line should show `already-present` and the output
   should report nothing new.
6. Clear the shell variables (`unset IMPORT_PASSWORD ...`).

## Rollback

Events are append-only, and the app's RLS does not allow deletes. If the import is
wrong, do not delete rows from the app. Use the SQL editor with a reviewed
statement against the specific session ID, or add corrective void events, after
checking with the owner.
