// Core type definitions for PRT Virtual Gym

export type EventType = 'pushups' | 'plank' | 'row_2k' | 'bike' | 'void';
export type SessionKind = 'saturday_prt' | 'practice';
export type SessionState = 'in_progress' | 'completed';
export type SyncStatus = 'queued' | 'syncing' | 'synced' | 'error';

// Database schemas (match Supabase)
export interface Session {
  session_id: string; // UUID
  user_id: string; // UUID
  kind: SessionKind;
  started_at: string; // ISO8601
  completed_at: string | null;
  state: SessionState;
  scoring_version: string;
  competitor_model_version: string;
  competitor_seed: number;
  baseline_snapshot: BaselineSnapshot | null;
  competitor_snapshot: CompetitorSnapshot;
  created_at: string;
}

export interface Event {
  event_id: string; // UUID
  session_id: string; // UUID
  event_type: EventType;
  raw_value: number | null; // reps or seconds
  unit: 'reps' | 's' | null;
  timestamp: string; // ISO8601
  source: 'app' | 'pm5';
  correction_of: string | null; // event_id
  voids_event_id: string | null; // event_id
  detail: RowDetail | null;
  created_at: string;
}

export interface RowDetail {
  avg_500m_split_sec?: number;
  stroke_rate?: number;
}

export interface BaselineSnapshot {
  pushups_median: number;
  plank_median_sec: number;
  row_median_sec: number;
}

export interface CompetitorSnapshot {
  peer: CompetitorResults;
  steady: CompetitorResults;
  volatile: CompetitorResults;
  rival: CompetitorResults;
  ghost_you: CompetitorResults | null;
}

export interface CompetitorResults {
  pushups: number;
  plank: number; // seconds
  row_2k: number; // seconds
}

// Local IndexedDB queue
export interface QueuedEvent {
  event_id: string;
  session_id: string;
  event_type: EventType;
  raw_value: number | null;
  unit: 'reps' | 's' | null;
  timestamp: string;
  source: 'app';
  detail: RowDetail | null;
  status: SyncStatus;
  error?: string;
}

// Session state (UI)
export interface SessionUIState {
  session_id: string;
  kind: SessionKind;
  state: SessionState;
  confirmed_events: {
    pushups?: { raw_value: number; points: number };
    plank?: { raw_value: number; points: number };
    row_2k?: { raw_value: number; points: number };
  };
  provisional_score: number;
  category: string;
  leaderboard: LeaderboardRow[];
  revealed_events: Set<EventType>;
  queued_count: number; // unsynced events
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  pushups?: number;
  pushups_score?: number;
  plank?: number;
  plank_score?: number;
  row_2k?: number;
  row_2k_score?: number;
  overall_score: number;
}

// Coach context (sent to Edge Function)
export interface CoachContext {
  confirmed_results: {
    pushups?: { raw_value: number; points: number };
    plank?: { raw_value: number; points: number };
    row_2k?: { raw_value: number; points: number };
  };
  pending_events: EventType[];
  provisional_score: number;
  category: string;
  points_to_next_tier: number;
  cheapest_improvement: {
    event: EventType;
    raw_value_needed: number;
    gain: number;
  } | null;
  revealed_leaderboard: LeaderboardRow[];
  recent_sessions: { date: string; score: number; category: string }[];
  pbs: { pushups: number; plank: number; row_2k: number };
  trend: 'improving' | 'stable' | 'declining';
  row_detail?: RowDetail;
}

// Coach endpoint request/response
export interface CoachRequest {
  session_id: string;
  question?: string;
}

export interface CoachResponse {
  advice: string;
  session_id: string;
}

// Auth
export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
}
