import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSession, getSessionEvents, updateSessionState, callCoach } from '../supabase';
import { queueEvent, getQueuedEventsBySession, getQueuedCount } from '../queue';
import { computeEffectiveResults, buildLeaderboard } from '../leaderboard';
import { eventPoints, composite, tierOf, navyScoring1_0 } from '../scoring';
import type { Session, Event, CompetitorSnapshot, LeaderboardRow } from '../types';
import '../styles/SessionScreen.css';

interface SessionScreenProps {
  sessionId: string;
  onEndSession: () => void;
}

type EventType = 'pushups' | 'plank' | 'row_2k';

export default function SessionScreen({ sessionId, onEndSession }: SessionScreenProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<EventType>('pushups');
  const [inputValue, setInputValue] = useState('');
  const [revealedEvents, setRevealedEvents] = useState<Set<EventType>>(new Set());
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [coachQuestion, setCoachQuestion] = useState('');
  const [coachResponse, setCoachResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    loadSession();
    const interval = setInterval(updateQueuedCount, 2000);
    return () => clearInterval(interval);
  }, []);

  // Restore revealed events and queue status on mount
  useEffect(() => {
    const restoreState = async () => {
      try {
        // Restore revealed events from unsynced queue
        const { getQueuedEventsBySession } = await import('../queue');
        const queued = await getQueuedEventsBySession(sessionId);
        const queuedEventTypes = new Set(queued.map(e => e.event_type as EventType));
        if (queuedEventTypes.size > 0) {
          setRevealedEvents(prev => new Set([...prev, ...queuedEventTypes]));
        }
      } catch (error) {
        console.error('Failed to restore session state:', error);
      }
    };
    restoreState();
  }, [sessionId]);

  useEffect(() => {
    if (session) {
      updateLeaderboard();
    }
  }, [events, session]);

  const loadSession = async () => {
    try {
      const sess = await getSession(sessionId);
      setSession(sess);

      const evts = await getSessionEvents(sessionId);
      setEvents(evts);

      updateQueuedCount();
    } catch (error) {
      console.error('Failed to load session:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateQueuedCount = async () => {
    try {
      const count = await getQueuedCount();
      setQueuedCount(count);
    } catch (error) {
      console.error('Failed to get queued count:', error);
    }
  };

  const updateLeaderboard = async () => {
    if (!session) return;

    try {
      const effectiveResults = computeEffectiveResults(events);
      const lb = buildLeaderboard(
        effectiveResults,
        session.competitor_snapshot,
        revealedEvents
      );
      setLeaderboard(lb);
    } catch (error) {
      console.error('Failed to update leaderboard:', error);
    }
  };

  const parseTimeInput = (input: string, eventType: EventType): number => {
    const trimmed = input.trim();

    // If it contains a colon, parse as mm:ss
    if (trimmed.includes(':')) {
      const parts = trimmed.split(':');
      if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10);
        const seconds = parseInt(parts[1], 10);
        if (!isNaN(minutes) && !isNaN(seconds)) {
          return minutes * 60 + seconds;
        }
      }
    }

    // Otherwise parse as raw seconds or reps
    return parseInt(trimmed, 10);
  };

  const validateInput = (input: string, eventType: EventType): { valid: boolean; error?: string } => {
    const trimmed = input.trim();

    if (!trimmed) {
      return { valid: false, error: 'Value cannot be empty' };
    }

    const rawValue = parseTimeInput(trimmed, eventType);

    if (isNaN(rawValue)) {
      return { valid: false, error: 'Invalid input. Use numbers or mm:ss format.' };
    }

    if (rawValue < 0) {
      return { valid: false, error: 'Value must be positive' };
    }

    // Check for absurd values
    if (eventType === 'pushups') {
      if (rawValue > 500) {
        return { valid: false, error: 'Too many push-ups (max 500)' };
      }
    } else if (eventType === 'plank' || eventType === 'row_2k') {
      // Times in seconds
      if (rawValue > 3600) { // More than 1 hour
        return { valid: false, error: 'Time too long (max 1 hour)' };
      }
    }

    return { valid: true };
  };

  const handleConfirmEvent = async () => {
    if (!inputValue || !session) return;

    // Validate input first
    const validation = validateInput(inputValue, currentEvent);
    if (!validation.valid) {
      alert(`Invalid ${currentEvent}: ${validation.error}`);
      return;
    }

    setConfirming(true);
    try {
      const rawValue = parseTimeInput(inputValue, currentEvent);

      const event_id = uuidv4();
      const timestamp = new Date().toISOString();

      // Queue the event locally
      await queueEvent({
        event_id,
        session_id: sessionId,
        event_type: currentEvent,
        raw_value: rawValue,
        unit: currentEvent === 'pushups' ? 'reps' : 's',
        timestamp,
        source: 'app',
        detail: null,
        status: 'queued'
      });

      // Reveal this event
      setRevealedEvents((prev) => new Set([...prev, currentEvent]));

      // Add to local events for immediate UI update
      setEvents((prev) => [
        ...prev,
        {
          event_id,
          session_id: sessionId,
          event_type: currentEvent,
          raw_value: rawValue,
          unit: currentEvent === 'pushups' ? 'reps' : 's',
          timestamp,
          source: 'app',
          correction_of: null,
          voids_event_id: null,
          detail: null,
          created_at: new Date().toISOString()
        }
      ]);

      // Move to next event
      const eventOrder: EventType[] = ['pushups', 'plank', 'row_2k'];
      const currentIndex = eventOrder.indexOf(currentEvent);
      if (currentIndex < eventOrder.length - 1) {
        setCurrentEvent(eventOrder[currentIndex + 1]);
      }

      setInputValue('');

      // Attempt immediate sync if online
      if (navigator.onLine) {
        try {
          const { syncQueue } = await import('../sync');
          await syncQueue();
        } catch (syncError) {
          // Sync error is not critical - event is queued locally
          console.log('Sync after confirm failed (will retry):', syncError);
        }
      }

      updateQueuedCount();
    } catch (error) {
      console.error('Failed to confirm event:', error);
      alert('Failed to confirm event');
    } finally {
      setConfirming(false);
    }
  };

  const handleCoach = async () => {
    if (!session) return;

    try {
      const response = await callCoach(sessionId, coachQuestion || undefined);
      setCoachResponse(response);
    } catch (error) {
      console.error('Coach call failed:', error);
      alert('Failed to get coaching advice');
    }
  };

  const handleSaveSession = async () => {
    try {
      // Check if all 3 events are confirmed
      const eventTypes = ['pushups', 'plank', 'row_2k'];
      const confirmedEvents = eventTypes.filter(type => {
        return events.some(e => e.event_type === type && !e.event_type.includes('void'));
      });

      if (confirmedEvents.length !== 3) {
        alert(`Session incomplete: ${confirmedEvents.length}/3 events entered`);
        return;
      }

      // Attempt to sync pending events
      let hasPending = false;
      if (navigator.onLine) {
        try {
          const { syncQueue } = await import('../sync');
          const result = await syncQueue();
          hasPending = queuedCount > 0;

          if (hasPending) {
            const warn = confirm(
              `${result.failed} event(s) still pending sync. Complete anyway?`
            );
            if (!warn) return;
          }
        } catch (syncError) {
          console.log('Sync before complete failed:', syncError);
          if (queuedCount > 0) {
            const warn = confirm(
              `${queuedCount} event(s) not synced. Complete anyway?`
            );
            if (!warn) return;
          }
        }
      } else {
        if (queuedCount > 0) {
          alert(`${queuedCount} event(s) queued for sync. Complete session (sync when online)?`);
        }
      }

      await updateSessionState(sessionId, 'completed');
      alert('Session completed and saved!');
      onEndSession();
    } catch (error) {
      console.error('Failed to save session:', error);
      alert(`Failed to save session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (loading || !session) {
    return <div className="session-screen">Loading session...</div>;
  }

  const effectiveResults = computeEffectiveResults(events);
  const userScore = composite(
    {
      pushups: effectiveResults.pushups?.raw_value,
      plank: effectiveResults.plank?.raw_value,
      row_2k: effectiveResults.row_2k?.raw_value
    },
    navyScoring1_0
  );
  const tier = tierOf(userScore, navyScoring1_0);

  return (
    <div className="session-screen">
      <header className="session-header">
        <h1>Saturday PRT</h1>
        <div className="session-status">
          {queuedCount > 0 && (
            <span className="queued-badge">{queuedCount} unsynced</span>
          )}
          <button onClick={handleSaveSession} className="primary-button">
            Save Session
          </button>
        </div>
      </header>

      <main className="session-main">
        <div className="session-left">
          {/* Entry panel */}
          <section className="entry-panel">
            <h3>Enter {currentEvent.replace('_', ' ')}</h3>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                currentEvent === 'pushups'
                  ? 'e.g., 38'
                  : currentEvent === 'plank'
                  ? 'e.g., 2:02 or 122'
                  : 'e.g., 8:50 or 530'
              }
              disabled={confirming}
              autoFocus
              inputMode={currentEvent === 'pushups' ? 'numeric' : 'decimal'}
            />
            <button
              onClick={handleConfirmEvent}
              disabled={!inputValue || confirming}
              className="primary-button"
            >
              {confirming ? 'Confirming...' : 'Confirm'}
            </button>
          </section>

          {/* Current score */}
          <section className="score-display">
            <h3>Your Score</h3>
            <div className="score-large">{userScore}</div>
            <div className="score-category">{tier.category}</div>
            <div className="score-gap">
              {tier.pointsToNext > 0
                ? `${tier.pointsToNext} points to ${tier.nextCategory}`
                : 'Outstanding! 🏆'}
            </div>
          </section>
        </div>

        <div className="session-right">
          {/* Leaderboard */}
          <section className="leaderboard-section">
            <h3>Leaderboard</h3>
            <table className="leaderboard">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Push-ups</th>
                  <th>Plank</th>
                  <th>Row</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.name} className={row.name === 'You' ? 'user-row' : ''}>
                    <td>{row.rank}</td>
                    <td>{row.name}</td>
                    <td>
                      {row.pushups_score ? (
                        <>
                          {row.pushups} ({row.pushups_score})
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.plank_score && row.plank ? (
                        <>
                          {Math.floor(row.plank / 60)}:{String(row.plank % 60).padStart(2, '0')} ({row.plank_score})
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.row_2k_score && row.row_2k ? (
                        <>
                          {Math.floor(row.row_2k / 60)}:{String(row.row_2k % 60).padStart(2, '0')} ({row.row_2k_score})
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="overall-score">{row.overall_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Coach */}
          <section className="coach-section">
            <h3>Coach</h3>
            <div className="coach-buttons">
              <button
                onClick={() => handleCoach()}
                className="secondary-button"
                disabled={!session}
              >
                Coach Me
              </button>
            </div>
            <div className="coach-input-group">
              <input
                type="text"
                value={coachQuestion}
                onChange={(e) => setCoachQuestion(e.target.value)}
                placeholder="Ask coach a question..."
              />
              <button
                onClick={handleCoach}
                className="primary-button"
                disabled={!coachQuestion}
              >
                Ask
              </button>
            </div>
            {coachResponse && (
              <div className="coach-response">{coachResponse}</div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
