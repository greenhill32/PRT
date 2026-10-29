import { useState, useEffect } from 'react';
import {
  getUserSessions,
  createSession,
  signOut,
  getPriorSaturdays,
  getSessionEvents,
  computeEffectiveResultsFromEvents
} from '../supabase';
import { generateBaseline, generateCompetitors } from '../competitors';
import { cacheBaseline, cacheCompetitors } from '../queue';
import type { Session } from '../types';
import '../styles/HomeScreen.css';

interface HomeScreenProps {
  user: any;
  onStartSession: (sessionId: string) => void;
  onLogout: () => void;
}

export default function HomeScreen({ user, onStartSession, onLogout }: HomeScreenProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await getUserSessions(10);
      setSessions(data as any);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSession = async (kind: 'saturday_prt' | 'practice') => {
    setStarting(true);
    try {
      // Get prior completed Saturday sessions
      const priors = await getPriorSaturdays(5);

      // For each prior session, fetch its events and compute effective results
      const priorResults: Array<{ pushups?: number; plank?: number; row_2k?: number }> = [];
      let mostRecentSessionResults: { pushups?: number; plank?: number; row_2k?: number } | null = null;

      for (const prior of priors) {
        const events = await getSessionEvents(prior.session_id);
        const effectiveResults = computeEffectiveResultsFromEvents(events);
        priorResults.push(effectiveResults);

        // Use the most recent session for Ghost You
        if (!mostRecentSessionResults) {
          mostRecentSessionResults = effectiveResults;
        }
      }

      // Generate baseline from actual results (or null if no prior results)
      const baseline = priorResults.length > 0 ? generateBaseline(priorResults) : null;

      const competitor_seed = Math.floor(Math.random() * 1000000);

      // Generate competitors (including Ghost You from real prior results if available)
      const ghostYouData = mostRecentSessionResults ? {
        pushups: mostRecentSessionResults.pushups || 0,
        plank: mostRecentSessionResults.plank || 0,
        row_2k: mostRecentSessionResults.row_2k || 0
      } : undefined;

      const competitors = generateCompetitors(
        baseline || {
          pushups_median: 30,
          plank_median_sec: 90,
          row_median_sec: 570
        },
        competitor_seed,
        ghostYouData
      );

      // Create session
      const session = await createSession(
        kind,
        competitor_seed,
        baseline,
        competitors
      );

      // Cache baseline and competitors for offline access
      if (baseline) {
        await cacheBaseline(session.session_id, baseline);
      }
      await cacheCompetitors(session.session_id, competitors);

      onStartSession(session.session_id);
    } catch (error) {
      console.error('Failed to start session:', error);
      alert('Failed to start session');
    } finally {
      setStarting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      onLogout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const getCategoryColor = (category: string): string => {
    switch (category) {
      case 'Outstanding':
        return '#10b981';
      case 'Excellent':
        return '#3b82f6';
      case 'Good':
        return '#f59e0b';
      case 'Satisfactory':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1>PRT Virtual Gym</h1>
        <div className="header-actions">
          <span className="user-email">{user?.email}</span>
          <button onClick={handleLogout} className="logout-button">
            Sign Out
          </button>
        </div>
      </header>

      <main className="home-content">
        <section className="start-session-section">
          <h2>Start a Session</h2>
          <div className="session-buttons">
            <button
              onClick={() => handleStartSession('saturday_prt')}
              disabled={starting}
              className="primary-button large"
            >
              {starting ? 'Starting...' : 'Start Saturday PRT'}
            </button>
            <button
              onClick={() => handleStartSession('practice')}
              disabled={starting}
              className="secondary-button large"
            >
              {starting ? 'Starting...' : 'Start Practice Session'}
            </button>
          </div>
        </section>

        <section className="recent-sessions-section">
          <h2>Recent Sessions</h2>
          {loading ? (
            <p>Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p>No sessions yet. Start your first PRT!</p>
          ) : (
            <div className="sessions-list">
              {sessions.map((session) => (
                <div
                  key={session.session_id}
                  className="session-card"
                  style={{
                    borderLeftColor: session.kind === 'saturday_prt' ? '#3b82f6' : '#6b7280',
                    cursor: session.state === 'in_progress' ? 'pointer' : 'default'
                  }}
                  onClick={() => {
                    if (session.state === 'in_progress') {
                      onStartSession(session.session_id);
                    }
                  }}
                >
                  <div className="session-date">
                    {new Date(session.started_at).toLocaleDateString()}
                  </div>
                  <div className="session-kind">
                    {session.kind === 'saturday_prt' ? '🏋️ Saturday PRT' : '📝 Practice'}
                  </div>
                  <div className="session-state">
                    {session.state === 'completed' ? '✓ Completed' : 'In Progress' + (session.state === 'in_progress' ? ' — tap to continue' : '')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
