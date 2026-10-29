-- Migration 002: Allow authenticated users to complete their own sessions
-- while keeping events completely append-only and protecting immutable fields
--
-- Problem: Original sessions_update policy was invalid (used NEW in RLS USING clause).
-- Sessions could never transition from in_progress to completed.
--
-- Solution: Use column-level grants instead of relying on policy field checks.
-- - Drop old invalid policy
-- - Revoke broad UPDATE
-- - Grant UPDATE only on (state, completed_at) columns
-- - Create new policy that enforces owner+state transition checks

-- Drop the overly-restrictive sessions_update policy
DROP POLICY IF EXISTS sessions_update ON sessions;

-- Revoke broad UPDATE from all roles
REVOKE UPDATE ON sessions FROM anon, authenticated;

-- Grant authenticated users UPDATE only on state and completed_at columns
GRANT UPDATE (state, completed_at) ON sessions TO authenticated;

-- Create a new UPDATE policy that:
-- - only allows the session owner to update
-- - only allows in_progress -> completed transition
-- - requires completed_at to be set when transitioning to completed
CREATE POLICY sessions_update ON sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    -- Owner-only
    auth.uid() = user_id
    -- Only allow transition to completed (not back to in_progress)
    AND (state = 'completed' OR OLD.state = 'in_progress')
  );

-- Note: Events remain completely append-only.
-- events_update and events_delete policies remain unchanged (both USING false).
-- This migration does NOT modify event policies.
