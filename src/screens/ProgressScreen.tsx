import { useEffect, useMemo, useState } from 'react';
import { getProgressHistory } from '../progressData';
import type { ProgressHistory } from '../progressData';
import {
  PERIODS, periodBounds, periodLabel, shiftPeriod, formatSessionDate, formatTime,
  createProgressRecords, selectProgressRecords, previousRecords, progressSummary,
  eventStatistics, buildLeague, sessionFinish, chartValues
} from '../progress';
import type { ProgressPeriod, ProgressMetric } from '../progress';
import { buildLeaderboard, computeEffectiveResults } from '../leaderboard';
import { scoringVersions } from '../scoring';
import { errorMessage } from '../eventPersistence';
import ProgressChart from '../components/ProgressChart';
import '../styles/ProgressScreen.css';

interface Props { userId: string; initialSessionId?: string | null; onBack: () => void; onViewSession: (id: string) => void }
const periodNames: Record<ProgressPeriod, string> = { session: 'Session', week: 'Week', month: 'Month', year: 'Year', all: 'All time' };
const metricNames: Record<ProgressMetric, string> = { score: 'PRT score', pushups: 'Push-ups', plank: 'Plank', row_2k: 'Row', sessions: 'Sessions' };
const round = (value: number | null, digits = 1) => value === null ? '—' : Number(value.toFixed(digits)).toString();
const signed = (value: number) => (value > 0 ? '+' : '') + round(value);
const eventNames = { pushups: 'Push-ups', plank: 'Plank', row_2k: '2km row' };

export default function ProgressScreen({ userId, initialSessionId, onBack, onViewSession }: Props) {
  const [history, setHistory] = useState<ProgressHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [period, setPeriod] = useState<ProgressPeriod>(initialSessionId ? 'session' : 'month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [sessionId, setSessionId] = useState(initialSessionId ?? '');
  const [includePractice, setIncludePractice] = useState(false);
  const [metric, setMetric] = useState<ProgressMetric>('score');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    getProgressHistory(userId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setHistory(data);
      setSessionId(previous => data.sessions.some(session => session.session_id === previous) ? previous
        : data.sessions.find(session => session.kind === 'saturday_prt')?.session_id ?? data.sessions[0]?.session_id ?? '');
    }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, reload]);

  const records = useMemo(() => history ? createProgressRecords(history.sessions, history.events) : [], [history]);
  const selected = useMemo(() => selectProgressRecords(records, period, anchor, includePractice, sessionId), [records, period, anchor, includePractice, sessionId]);
  const previous = useMemo(() => previousRecords(records, selected, period, anchor, includePractice), [records, selected, period, anchor, includePractice]);
  const summary = useMemo(() => progressSummary(selected, previous), [selected, previous]);
  const statistics = useMemo(() => eventStatistics(selected, previous), [selected, previous]);
  const league = useMemo(() => buildLeague(selected), [selected]);
  const points = useMemo(() => chartValues(selected, metric, period, anchor), [selected, metric, period, anchor]);
  const finish = period === 'session' ? sessionFinish(selected[0]) : null;
  const you = league.rows.find(row => row.key === 'you');
  const sharedPosition = you && league.rows.filter(row => row.rank === you.rank).length > 1;
  const current = selected[0];
  const sessionLeaderboard = useMemo(() => {
    if (period !== 'session' || !current || current.score === null || current.session.kind !== 'saturday_prt') return [];
    const context = scoringVersions[current.session.scoring_version];
    const events = history!.events.filter(event => event.session_id === current.session.session_id);
    return buildLeaderboard(computeEffectiveResults(events, context), current.session.competitor_snapshot,
      new Set(['pushups', 'plank', 'row_2k']), context);
  }, [period, current, history]);
  const canMoveForward = period !== 'all' && period !== 'session' &&
    periodBounds(period, anchor)!.start < periodBounds(period, new Date())!.start;
  const priorLabel = period === 'session' ? 'previous session' : 'previous ' + period;
  const issues = selected.filter(record => record.issue).length;
  const eventValue = (type: keyof typeof eventNames, value: number | null) => type === 'pushups' ? round(value) : formatTime(value);

  return <div className="progress-screen">
    <div className="progress-shell">
      <header className="progress-header">
        <div><div className="progress-eyebrow">PRT VIRTUAL GYM</div><h1>Your progress<span>.</span></h1>
          <p>Your effort, over time.</p></div>
        <div className="progress-header-actions">
          <button className="progress-button" onClick={onBack}>Home</button>
          <button className="progress-button" onClick={() => setReload(value => value + 1)} disabled={loading}>Refresh</button>
        </div>
      </header>
      <nav className="progress-periods" aria-label="Progress period">
        {PERIODS.map(value => <button key={value} aria-pressed={period === value}
          onClick={() => { setPeriod(value); setAnchor(new Date()); }}>{periodNames[value]}</button>)}
      </nav>
      <div className="progress-period-heading">
        {period === 'session' ? <label className="progress-session-picker">Saved session
          <select aria-label="Saved session" value={sessionId} onChange={event => setSessionId(event.target.value)}>
            {records.slice().reverse().map(record => <option key={record.session.session_id} value={record.session.session_id}>
              {formatSessionDate(record.date) + ' · ' + (record.session.kind === 'practice' ? 'Practice' : 'Saturday PRT')}
            </option>)}
          </select>
        </label> : <div className="progress-calendar">
          {period !== 'all' && <button aria-label="Previous period" className="progress-arrow" onClick={() => setAnchor(shiftPeriod(anchor, period, -1))}>‹</button>}
          <h2>{periodLabel(period, anchor)}</h2>
          {period !== 'all' && <button aria-label="Next period" className="progress-arrow" disabled={!canMoveForward} onClick={() => setAnchor(shiftPeriod(anchor, period, 1))}>›</button>}
        </div>}
        {period !== 'session' && <label className="progress-practice"><input type="checkbox" checked={includePractice}
          onChange={event => setIncludePractice(event.target.checked)} /> Include practice</label>}
      </div>
      {loading ? <div role="status" className="progress-empty">Loading your complete history…</div> :
        error ? <div role="alert" className="progress-empty"><h2>Progress could not be loaded</h2><p>{error}</p>
          <button className="progress-button" onClick={() => setReload(value => value + 1)}>Try again</button></div> :
        <>
          {history?.source === 'cache' && <p role="status" className="progress-notice">Offline snapshot · saved {formatSessionDate(history.fetchedAt)}. Reconnect and refresh for newer results.</p>}
          {history?.warning && <p role="status" className="progress-notice">{history.warning}</p>}
          {!records.length ? <div className="progress-empty"><h2>Your progress starts with one session.</h2>
            <p>Complete a PRT or practice session to see your results here.</p><button className="progress-button" onClick={onBack}>Record your first session</button></div> : <>
            <div className="progress-cards">
              <article className="progress-stat progress-stat-featured"><span>{period === 'session' ? 'PRT score' : 'Sessions recorded'}</span>
                <strong>{period === 'session' ? round(current?.score ?? null, 0) : summary.count}</strong>
                <small>{period === 'session' ? 'out of 100' : includePractice ? 'PRT + practice' : 'Saturday PRTs'}</small></article>
              <article className="progress-stat"><span>{period === 'session' ? 'Session finish' : 'Average PRT'}</span>
                <strong>{period === 'session' ? finish ? (finish.tied ? '=' : '') + finish.rank + '/' + finish.total : '—' : round(summary.average)}</strong>
                <small className={summary.change !== null && summary.change > 0 ? 'progress-positive' : ''}>
                  {period === 'session' ? current?.session.kind === 'practice' ? 'Practice has no opponents' : 'including Ghost, if available'
                    : summary.change === null ? 'from complete scored sessions' : signed(summary.change) + ' pts vs ' + priorLabel}</small></article>
              <article className="progress-stat"><span>{period === 'session' ? 'Change in score' : 'Best PRT'}</span>
                <strong>{period === 'session' ? summary.change === null ? '—' : signed(summary.change) : round(summary.best, 0)}</strong>
                <small>{period === 'session' ? 'vs ' + priorLabel : 'highest score in this period'}</small></article>
              <article className="progress-stat"><span>{period === 'session' ? 'Events confirmed' : 'League position'}</span>
                <strong>{period === 'session' ? Object.keys(current?.results ?? {}).length + '/3' : you ? (sharedPosition ? '=' : '') + you.rank + '/5' : '—'}</strong>
                <small>{period === 'session' ? 'push-ups · plank · row' : league.counted + ' league sessions'}</small></article>
            </div>
            {!selected.length && <p className="progress-notice">No completed sessions in this period. Try another period or include practice.</p>}
            {issues > 0 && <p role="status" className="progress-notice">{issues} saved session(s) have missing/invalid results or an unknown scoring version. Their composite scores are excluded from averages and league points.</p>}
            <section className="progress-panel">
              <div className="progress-section-heading"><div><div className="progress-eyebrow">THE THREE EVENTS</div><h2>Every result counts.</h2></div>
                <span className="progress-muted">{period === 'session' ? 'Compared with your previous session' : 'Within the selected period'}</span></div>
              <div className="progress-events">{statistics.map(stat => <article className="progress-event" key={stat.type}>
                <div className={'progress-event-icon progress-event-' + stat.type}>{stat.type === 'pushups' ? 'PU' : stat.type === 'plank' ? 'PL' : '2K'}</div>
                <div className="progress-event-title"><h3>{eventNames[stat.type]}</h3><span>{stat.type === 'pushups' ? 'repetitions' : stat.type === 'plank' ? 'hold time' : 'finish time'}</span></div>
                <strong className="progress-event-latest">{eventValue(stat.type, stat.latest)}</strong>
                <dl><div><dt>Average</dt><dd>{eventValue(stat.type, stat.average)}</dd></div>
                  <div><dt>{stat.type === 'row_2k' ? 'Fastest' : 'Best'}</dt><dd>{eventValue(stat.type, stat.best)}</dd></div>
                  <div><dt>Change</dt><dd className={stat.improvement !== null && stat.improvement > 0 ? 'progress-positive' : ''}>
                    {stat.improvement === null ? '—' : signed(stat.improvement) + (stat.type === 'pushups' ? ' reps' : 's')}</dd></div></dl>
              </article>)}</div>
              <p className="progress-footnote">{period === 'all' ? 'Choose a session, week, month or year to compare with the previous period.' : 'Change compares averages with the ' + priorLabel + '. Positive means improvement, including faster rowing.'}</p>
            </section>
            <section className="progress-panel">
              <div className="progress-section-heading"><div><div className="progress-eyebrow">THE BIGGER PICTURE</div><h2>{metric === 'sessions' ? 'Keep showing up.' : 'See your progress.'}</h2></div>
                <span className="progress-muted">{points.length} {metric === 'sessions' ? 'periods' : 'results'}</span></div>
              <div className="progress-chart-tabs" role="group" aria-label="Chart metric">
                {(Object.keys(metricNames) as ProgressMetric[]).map(value => <button key={value} aria-pressed={metric === value} onClick={() => setMetric(value)}>{metricNames[value]}</button>)}
              </div>
              <ProgressChart points={points} metric={metric} onOpenSession={onViewSession} />
              <p className="progress-footnote">{metric === 'row_2k' ? 'Lower is faster. Times are shown as minutes:seconds.' : metric === 'sessions' ? 'Completed sessions grouped by day, week, month or year within this period.' : 'Select a point to open its saved session.'}</p>
            </section>
            <div className="progress-bottom-grid">
              <section className="progress-panel">
                <div className="progress-section-heading"><div><div className="progress-eyebrow">FRIENDLY COMPETITION</div><h2>{period === 'session' ? 'Final leaderboard' : 'The league'}</h2></div>
                  <span className="progress-tag">{period === 'session' ? 'This session' : league.counted + ' sessions'}</span></div>
                {period === 'session' ? sessionLeaderboard.length ? <table className="progress-league">
                  <thead><tr><th>Rank</th><th>Competitor</th><th>PRT score</th></tr></thead>
                  <tbody>{sessionLeaderboard.map(row => <tr key={row.name} className={row.name === 'You' ? 'progress-you' : ''}>
                    <td>{row.rank}</td><td>{row.name}</td><td>{row.overall_score}</td></tr>)}</tbody>
                </table> : <p className="progress-muted">A final leaderboard is available for complete Saturday PRTs.</p>
                  : league.rows.length ? <table className="progress-league">
                    <thead><tr><th>Rank</th><th>Competitor</th><th>Played</th><th>Wins</th><th>Points</th><th>Avg PRT</th></tr></thead>
                    <tbody>{league.rows.map(row => <tr key={row.key} className={row.key === 'you' ? 'progress-you' : ''}>
                      <td>{row.rank}</td><td>{row.name}</td><td>{row.played}</td><td>{row.wins}</td><td><strong>{round(row.points)}</strong></td><td>{round(row.averageScore)}</td>
                    </tr>)}</tbody></table> : <p className="progress-muted">Complete a Saturday PRT with all four opponents to start your league.</p>}
                <p className="progress-footnote">League places earn 5, 4, 3, 2, 1 points. Ties share points; tied first places count as wins. Practice and Ghost You do not enter the league. Opponents adapt; raw PRT scores track fitness.</p>
                {league.skipped > 0 && <p className="progress-footnote">{league.skipped} PRT(s) excluded from league points because results or opponent snapshots are incomplete.</p>}
              </section>
              <section className="progress-panel">
                <div className="progress-section-heading"><div><div className="progress-eyebrow">EFFORT RECORDED</div><h2>It adds up.</h2></div></div>
                <dl className="progress-totals"><div><dt>Recorded push-ups</dt><dd>{summary.recordedPushups}</dd></div>
                  <div><dt>Total plank time</dt><dd>{formatTime(summary.recordedPlankSeconds)}</dd></div>
                  <div><dt>Rowing distance</dt><dd>{summary.rowDistanceKm} <small>km</small></dd></div></dl>
                <p className="progress-footnote">Totals cover logged test results in this period. Each confirmed 2km row contributes 2km.</p>
              </section>
            </div>
            <section className="progress-panel">
              <div className="progress-section-heading"><div><div className="progress-eyebrow">YOUR RECORD</div><h2>Sessions in this view</h2></div>
                <span className="progress-muted">{selected.length} completed</span></div>
              <div className="progress-history">{selected.slice().reverse().map(record => <button key={record.session.session_id}
                onClick={() => onViewSession(record.session.session_id)}>
                <span><strong>{formatSessionDate(record.date)}</strong><small>{record.session.kind === 'practice' ? 'Practice' : 'Saturday PRT'}{record.issue ? ' · needs review' : ''}</small></span>
                <span className="progress-history-score">{round(record.score, 0)} <small>pts</small><span aria-hidden="true"> ›</span></span>
              </button>)}</div>
            </section>
          </>}
        </>}
      <footer className="progress-footer">Your data. Your pace. · UK calendar periods · Completed sessions only</footer>
    </div>
  </div>;
}
