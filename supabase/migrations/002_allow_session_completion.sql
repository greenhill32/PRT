-- Migration 002: Allow session completion while maintaining append-only event ledger
--
-- Problem: Sessions created with state='in_progress' cannot be updated to 'completed'
-- because the initial RLS policy blocks ALL updates (USING false).
-- This breaks baseline generation because getPriorSaturdays() needs completed sessions.
--
-- Solution: Allow only the session owner to transition in_progress -> completed,
-- while keeping events completely append-only and protecting sensitive session fields.

-- Drop the overly restrictive sessions_update policy
DROP POLICY IF EXISTS sessions_update ON sessions;

-- Create a new UPDATE policy that allows session completion
-- Users can update their own sessions, but only to set state and completed_at
CREATE POLICY sessions_update ON sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    -- Only allow updates by the session owner
    auth.uid() = user_id
    -- Prevent changing immutable fields (user_id, seed, snapshots, versions)
    AND user_id = (SELECT user_id FROM sessions WHERE session_id = NEW.session_id)
    AND competitor_seed = (SELECT competitor_seed FROM sessions WHERE session_id = NEW.session_id)
    AND baseline_snapshot IS NOT DISTINCT FROM (SELECT baseline_snapshot FROM sessions WHERE session_id = NEW.session_id)
    AND competitor_snapshot = (SELECT competitor_snapshot FROM sessions WHERE session_id = NEW.session_id)
    AND scoring_version = (SELECT scoring_version FROM sessions WHERE session_id = NEW.session_id)
    AND competitor_model_version = (SELECT competitor_model_version FROM sessions WHERE session_id = NEW.session_id)
  );

-- Note: Events remain completely append-only.
-- events_update and events_delete policies remain unchanged (both USING false).
-- This migration does NOT modify event policies.
