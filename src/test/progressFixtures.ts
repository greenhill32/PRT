import type { Session, Event, CompetitorResults } from '../types';
export const RESULTS: CompetitorResults = { pushups: 38, plank: 122, row_2k: 530 };
export function savedSession(id: string, date: string, kind: Session['kind'] = 'saturday_prt'): Session {
  return {
    session_id: id, user_id: 'owner', kind, started_at: date, completed_at: date,
    created_at: date, state: 'completed', scoring_version: '1.0', competitor_model_version: '2.0', competitor_seed: 1,
    baseline_snapshot: null, competitor_snapshot: {
      peer: { pushups: 32, plank: 104, row_2k: 550 }, steady: { pushups: 16, plank: 87, row_2k: 570 },
      volatile: { pushups: 48, plank: 148, row_2k: 500 }, rival: { pushups: 46, plank: 139, row_2k: 510 },
      ghost_you: { pushups: 60, plank: 174, row_2k: 460 }
    }
  };
}
export function savedEvents(session: Session, results = RESULTS): Event[] {
  return (['pushups', 'plank', 'row_2k'] as const).map(type => ({
    event_id: session.session_id + '-' + type, session_id: session.session_id, event_type: type,
    raw_value: results[type], unit: type === 'pushups' ? 'reps' : 's', timestamp: session.started_at,
    created_at: session.started_at, source: 'app', correction_of: null, voids_event_id: null, detail: null
  }));
}
