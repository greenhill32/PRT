import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSession, getSessionEvents, updateSessionState, callCoach } from '../supabase';
import { queueEvent, getQueuedCount } from '../queue';
import { computeEffectiveResults, buildLeaderboard } from '../leaderboard';
import { composite, tierOf, navyScoring1_0 } from '../scoring';
import '../styles/SessionScreen.css';
export default function SessionScreen({ sessionId, onEndSession }) {
    const [session, setSession] = useState(null);
    const [events, setEvents] = useState([]);
    const [queuedCount, setQueuedCount] = useState(0);
    const [currentEvent, setCurrentEvent] = useState('pushups');
    const [inputValue, setInputValue] = useState('');
    const [revealedEvents, setRevealedEvents] = useState(new Set());
    const [leaderboard, setLeaderboard] = useState([]);
    const [coachQuestion, setCoachQuestion] = useState('');
    const [coachResponse, setCoachResponse] = useState('');
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(false);
    useEffect(() => {
        loadSession();
        const interval = setInterval(updateQueuedCount, 2000);
        return () => clearInterval(interval);
    }, []);
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
        }
        catch (error) {
            console.error('Failed to load session:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const updateQueuedCount = async () => {
        try {
            const count = await getQueuedCount();
            setQueuedCount(count);
        }
        catch (error) {
            console.error('Failed to get queued count:', error);
        }
    };
    const updateLeaderboard = async () => {
        if (!session)
            return;
        try {
            const effectiveResults = computeEffectiveResults(events);
            const lb = buildLeaderboard(effectiveResults, session.competitor_snapshot, revealedEvents);
            setLeaderboard(lb);
        }
        catch (error) {
            console.error('Failed to update leaderboard:', error);
        }
    };
    const parseTimeInput = (input, eventType) => {
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
    const handleConfirmEvent = async () => {
        if (!inputValue || !session)
            return;
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
            const eventOrder = ['pushups', 'plank', 'row_2k'];
            const currentIndex = eventOrder.indexOf(currentEvent);
            if (currentIndex < eventOrder.length - 1) {
                setCurrentEvent(eventOrder[currentIndex + 1]);
            }
            setInputValue('');
            updateQueuedCount();
        }
        catch (error) {
            console.error('Failed to confirm event:', error);
            alert('Failed to confirm event');
        }
        finally {
            setConfirming(false);
        }
    };
    const handleCoach = async () => {
        if (!session)
            return;
        try {
            const response = await callCoach(sessionId, coachQuestion || undefined);
            setCoachResponse(response);
        }
        catch (error) {
            console.error('Coach call failed:', error);
            alert('Failed to get coaching advice');
        }
    };
    const handleSaveSession = async () => {
        try {
            await updateSessionState(sessionId, 'completed');
            alert('Session saved!');
            onEndSession();
        }
        catch (error) {
            console.error('Failed to save session:', error);
            alert('Failed to save session');
        }
    };
    if (loading || !session) {
        return _jsx("div", { className: "session-screen", children: "Loading session..." });
    }
    const effectiveResults = computeEffectiveResults(events);
    const userScore = composite({
        pushups: effectiveResults.pushups?.raw_value,
        plank: effectiveResults.plank?.raw_value,
        row_2k: effectiveResults.row_2k?.raw_value
    }, navyScoring1_0);
    const tier = tierOf(userScore, navyScoring1_0);
    return (_jsxs("div", { className: "session-screen", children: [_jsxs("header", { className: "session-header", children: [_jsx("h1", { children: "Saturday PRT" }), _jsxs("div", { className: "session-status", children: [queuedCount > 0 && (_jsxs("span", { className: "queued-badge", children: [queuedCount, " unsynced"] })), _jsx("button", { onClick: handleSaveSession, className: "primary-button", children: "Save Session" })] })] }), _jsxs("main", { className: "session-main", children: [_jsxs("div", { className: "session-left", children: [_jsxs("section", { className: "entry-panel", children: [_jsxs("h3", { children: ["Enter ", currentEvent.replace('_', ' ')] }), _jsx("input", { type: "text", value: inputValue, onChange: (e) => setInputValue(e.target.value), placeholder: currentEvent === 'pushups'
                                            ? 'e.g., 38'
                                            : currentEvent === 'plank'
                                                ? 'e.g., 2:02 or 122'
                                                : 'e.g., 8:50 or 530', disabled: confirming, autoFocus: true, inputMode: currentEvent === 'pushups' ? 'numeric' : 'decimal' }), _jsx("button", { onClick: handleConfirmEvent, disabled: !inputValue || confirming, className: "primary-button", children: confirming ? 'Confirming...' : 'Confirm' })] }), _jsxs("section", { className: "score-display", children: [_jsx("h3", { children: "Your Score" }), _jsx("div", { className: "score-large", children: userScore }), _jsx("div", { className: "score-category", children: tier.category }), _jsx("div", { className: "score-gap", children: tier.pointsToNext > 0
                                            ? `${tier.pointsToNext} points to ${tier.nextCategory}`
                                            : 'Outstanding! 🏆' })] })] }), _jsxs("div", { className: "session-right", children: [_jsxs("section", { className: "leaderboard-section", children: [_jsx("h3", { children: "Leaderboard" }), _jsxs("table", { className: "leaderboard", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Rank" }), _jsx("th", { children: "Name" }), _jsx("th", { children: "Push-ups" }), _jsx("th", { children: "Plank" }), _jsx("th", { children: "Row" }), _jsx("th", { children: "Score" })] }) }), _jsx("tbody", { children: leaderboard.map((row) => (_jsxs("tr", { className: row.name === 'You' ? 'user-row' : '', children: [_jsx("td", { children: row.rank }), _jsx("td", { children: row.name }), _jsx("td", { children: row.pushups_score ? (_jsxs(_Fragment, { children: [row.pushups, " (", row.pushups_score, ")"] })) : ('—') }), _jsx("td", { children: row.plank_score && row.plank ? (_jsxs(_Fragment, { children: [Math.floor(row.plank / 60), ":", String(row.plank % 60).padStart(2, '0'), " (", row.plank_score, ")"] })) : ('—') }), _jsx("td", { children: row.row_2k_score && row.row_2k ? (_jsxs(_Fragment, { children: [Math.floor(row.row_2k / 60), ":", String(row.row_2k % 60).padStart(2, '0'), " (", row.row_2k_score, ")"] })) : ('—') }), _jsx("td", { className: "overall-score", children: row.overall_score })] }, row.name))) })] })] }), _jsxs("section", { className: "coach-section", children: [_jsx("h3", { children: "Coach" }), _jsx("div", { className: "coach-buttons", children: _jsx("button", { onClick: () => handleCoach(), className: "secondary-button", disabled: !session, children: "Coach Me" }) }), _jsxs("div", { className: "coach-input-group", children: [_jsx("input", { type: "text", value: coachQuestion, onChange: (e) => setCoachQuestion(e.target.value), placeholder: "Ask coach a question..." }), _jsx("button", { onClick: handleCoach, className: "primary-button", disabled: !coachQuestion, children: "Ask" })] }), coachResponse && (_jsx("div", { className: "coach-response", children: coachResponse }))] })] })] })] }));
}
