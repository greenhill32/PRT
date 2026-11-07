-- Adds 'accessory' to the append-only event ledger for supplementary strength work.
-- Additive only: no existing rows are changed, moved or removed.
-- Accessory events never feed scoring; computeEffectiveRawResults and the completion
-- policy in migrations 002/003 consider only pushups, plank and row_2k.
-- Exercise details (exercise, load_kg, sets, reps_per_set, tempo) live in events.detail.
BEGIN;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('pushups', 'plank', 'row_2k', 'bike', 'void', 'accessory'));

COMMIT;
