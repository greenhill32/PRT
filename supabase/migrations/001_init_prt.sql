-- Create sessions table
CREATE TABLE sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'saturday_prt' CHECK (kind IN ('saturday_prt', 'practice')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  scoring_version TEXT NOT NULL DEFAULT '1.0',
  competitor_model_version TEXT NOT NULL DEFAULT '1.0',
  competitor_seed INT NOT NULL,
  baseline_snapshot JSONB,
  competitor_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_kind ON sessions(kind) WHERE kind = 'saturday_prt';
CREATE INDEX idx_sessions_state ON sessions(state);

-- Create events table (append-only ledger)
CREATE TABLE events (
  event_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('pushups', 'plank', 'row_2k', 'bike', 'void')),
  raw_value INT,
  unit TEXT CHECK (unit IN ('reps', 's')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'pm5')),
  correction_of UUID REFERENCES events(event_id),
  voids_event_id UUID REFERENCES events(event_id),
  detail JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_voids ON events(voids_event_id) WHERE voids_event_id IS NOT NULL;
CREATE INDEX idx_events_correction_of ON events(correction_of) WHERE correction_of IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sessions
CREATE POLICY sessions_insert ON sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_select ON sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY sessions_update ON sessions
  FOR UPDATE
  USING (false);

CREATE POLICY sessions_delete ON sessions
  FOR DELETE
  USING (false);

-- RLS Policies for events
CREATE POLICY events_insert ON events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.session_id = events.session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY events_select ON events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.session_id = events.session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY events_update ON events
  FOR UPDATE
  USING (false);

CREATE POLICY events_delete ON events
  FOR DELETE
  USING (false);

-- Comments for documentation
COMMENT ON TABLE sessions IS 'PRT session records - one per user per Saturday or practice';
COMMENT ON TABLE events IS 'Append-only event ledger - the single source of truth for all results';
COMMENT ON COLUMN sessions.competitor_snapshot IS 'JSON snapshot of generated competitors: {peer, steady, volatile, rival, ghost_you}';
COMMENT ON COLUMN events.voids_event_id IS 'If set, this event is a void marker for the referenced event (correction flow)';
