import { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSession, getSessionEvents, callCoach } from '../supabase';
import { queueEvent, getQueuedEventsBySession, getQueuedCount } from '../queue';
import { computeEffectiveResults, buildLeaderboard } from '../leaderboard';
import { composite, tierOf, scoringVersions } from '../scoring';
import { syncQueue, completeSession } from '../sync';
import { mergeSessionEvents, nextMissingEvent, parseEventInput, queuedToEvent, revealedFromEvents } from '../sessionState';
import { errorMessage } from '../eventPersistence';
import type { Session, Event, QueuedEvent } from '../types';
import type { WorkoutEventType } from '../sessionState';
import '../styles/SessionScreen.css';

interface SessionScreenProps { sessionId: string; onEndSession: () => void }

export default function SessionScreen({ sessionId, onEndSession }: SessionScreenProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<WorkoutEventType | null>('pushups');
  const [inputValue, setInputValue] = useState('');
  const [coachQuestion, setCoachQuestion] = useState('');
  const [coachResponse, setCoachResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  const updateQueuedCount = async () => setQueuedCount(await getQueuedCount(sessionId));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const sess = await getSession(sessionId);
        const serverEvents = await getSessionEvents(sessionId);
        const localEvents = await getQueuedEventsBySession(sessionId);
        const merged = mergeSessionEvents(sessionId, serverEvents, localEvents);
        if (cancelled) return;
        setSession(sess);
        setEvents(merged);
        setCurrentEvent(nextMissingEvent(merged));
        setQueuedCount(await getQueuedCount(sessionId));
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(() => { void updateQueuedCount().catch(console.error); }, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId]);

  const context = session ? scoringVersions[session.scoring_version] : undefined;
  const effectiveResults = useMemo(() => computeEffectiveResults(events, context), [events, context]);
  const revealedEvents = useMemo(() => revealedFromEvents(events), [events]);
  const leaderboard = useMemo(() => session?.kind === 'saturday_prt' && context
    ? buildLeaderboard(effectiveResults, session.competitor_snapshot, revealedEvents, context) : [],
    [session, context, effectiveResults, revealedEvents]);
  const userScore = context ? composite({
    pushups: effectiveResults.pushups?.raw_value, plank: effectiveResults.plank?.raw_value,
    row_2k: effectiveResults.row_2k?.raw_value
  }, context) : 0;
  const tier = context ? tierOf(userScore, context) : { category: '', pointsToNext: 0, nextCategory: '' };

  const handleConfirmEvent = async () => {
    if (!session || !currentEvent || confirming || session.state !== 'in_progress') return;
    setMessage('');
    setConfirming(true);
    try {
      const rawValue = parseEventInput(inputValue, currentEvent);
      const event: QueuedEvent = {
        event_id: uuidv4(), session_id: sessionId, user_id: session.user_id,
        event_type: currentEvent, raw_value: rawValue,
        unit: currentEvent === 'pushups' ? 'reps' : 's',
        timestamp: new Date().toISOString(), source: 'app', detail: null, status: 'queued'
      };
      await queueEvent(event);
      const updated = [...events, queuedToEvent(event)];
      setEvents(updated);
      setCurrentEvent(nextMissingEvent(updated));
      setInputValue('');
      await updateQueuedCount();
      if (navigator.onLine) {
        // Confirmation is durable locally; a slow network never holds the form open.
        void syncQueue().then(async result => {
          await updateQueuedCount();
          if (result.errors.length) setMessage('Saved on this device. Upload will retry when the connection recovers.');
        }).catch(error => setMessage(errorMessage(error)));
      }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setConfirming(false); }
  };

  const handleCoach = async () => {
    try {
      if (!navigator.onLine) throw new Error('Coaching requires an internet connection.');
      await syncQueue();
      if (await getQueuedCount(sessionId)) throw new Error('Sync your results before asking the coach.');
      setCoachResponse(await callCoach(sessionId, coachQuestion || undefined));
    } catch (error) { setMessage(errorMessage(error)); }
  };

  const handleSaveSession = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      if (nextMissingEvent(events)) throw new Error('Confirm all three results before completing the session.');
      await completeSession(sessionId);
      onEndSession();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); await updateQueuedCount().catch(console.error); }
  };

  if (loading) return <div className="session-screen">Loading session...</div>;
  if (loadError || !session || !context) return <div className="session-screen">
    <p role="alert">{loadError || 'This session uses an unsupported scoring version.'}</p>
    <button onClick={onEndSession}>Back to sessions</button>
  </div>;

  return (
    <div className="session-screen">
      <header className="session-header">
        <h1>{session.kind === 'practice' ? 'Practice' : 'Saturday PRT'}</h1>
        <div className="session-status">
          {queuedCount > 0 && (
            <span className="queued-badge">{queuedCount} unsynced</span>
          )}
          <button onClick={onEndSession} className="secondary-button">Back</button>
          {session.state === 'in_progress' && <button onClick={handleSaveSession} className="primary-button" disabled={saving || confirming}>
            {saving ? 'Saving...' : 'Save Session'}
          </button>}
        </div>
      </header>

      <main className="session-main">
        {message && <p role="alert" className="session-message">{message}</p>}
        <div className="session-left">
          {/* Entry panel */}
          {currentEvent && session.state === 'in_progress' ? <section className="entry-panel">
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
          </section> : null}

          {!currentEvent && <p>All three events confirmed. {session.state === 'completed' ? 'Session completed.' : 'Save Session when your results have synced.'}</p>}
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
          {session.kind === 'saturday_prt' && <section className="leaderboard-section">
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
                      {row.pushups_score !== undefined ? (
                        <>
                          {row.pushups} ({row.pushups_score})
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.plank_score !== undefined && row.plank !== undefined ? (
                        <>
                          {Math.floor(row.plank / 60)}:{String(row.plank % 60).padStart(2, '0')} ({row.plank_score})
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.row_2k_score !== undefined && row.row_2k !== undefined ? (
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
          </section>}

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
