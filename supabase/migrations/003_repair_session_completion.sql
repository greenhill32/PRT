-- Forward repair: run even if an earlier version of migration 002 was applied.
-- Safe to reapply; events remain append-only.
-- ### Schema and policy changes only; no workout rows are changed or removed.
-- Correct session completion for both fresh installs and existing deployments.
BEGIN;

DROP POLICY IF EXISTS sessions_update ON public.sessions;
REVOKE UPDATE ON public.sessions FROM PUBLIC, anon, authenticated;
GRANT UPDATE (state, completed_at) ON public.sessions TO authenticated;

CREATE POLICY sessions_update ON public.sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND state = 'in_progress')
  WITH CHECK (
    auth.uid() = user_id
    AND state = 'completed'
    AND completed_at IS NOT NULL
    -- Completion requires three effective, persisted results, including zero scores.
    AND (
      SELECT count(DISTINCT e.event_type)
      FROM public.events e
      WHERE e.session_id = sessions.session_id
        AND e.event_type IN ('pushups', 'plank', 'row_2k')
        AND e.raw_value IS NOT NULL
        AND e.raw_value >= 0
        AND (e.event_type <> 'row_2k' OR e.raw_value > 0)
        AND NOT EXISTS (
          SELECT 1 FROM public.events v
          WHERE v.session_id = e.session_id
            AND v.event_type = 'void'
            AND v.voids_event_id = e.event_id
        )
    ) = 3
  );

COMMIT;
