import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { getUserSessions, createSession, signOut, getPriorSaturdays, getSessionEvents } from '../supabase';
import { generateBaseline, generateCompetitors } from '../competitors';
import { cacheBaseline, cacheCompetitors } from '../queue';
import '../styles/HomeScreen.css';
export default function HomeScreen({ user, onStartSession, onLogout }) {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    useEffect(() => {
        loadSessions();
    }, []);
    const loadSessions = async () => {
        try {
            const data = await getUserSessions(10);
            setSessions(data);
        }
        catch (error) {
            console.error('Failed to load sessions:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleStartSession = async (kind) => {
        setStarting(true);
        try {
            // Get prior sessions for baseline
            const priors = await getPriorSaturdays(5);
            // For each prior session, fetch its events to get actual results
            const priorsWithResults = [];
            for (const prior of priors) {
                const events = await getSessionEvents(prior.session_id);
                // Extract effective results (simplified - in real app, would use computeEffectiveResults)
                priorsWithResults.push(prior);
            }
            // Generate or use baseline
            let baseline = priors.length >= 3
                ? generateBaseline(priorsWithResults)
                : null;
            const competitor_seed = Math.floor(Math.random() * 1000000);
            // Generate competitors
            const competitors = generateCompetitors(baseline || {
                pushups_median: 30,
                plank_median_sec: 90,
                row_median_sec: 570
            }, competitor_seed);
            // Create session
            const session = await createSession(kind, competitor_seed, baseline, competitors);
            // Cache baseline and competitors for offline access
            if (baseline) {
                await cacheBaseline(session.session_id, baseline);
            }
            await cacheCompetitors(session.session_id, competitors);
            onStartSession(session.session_id);
        }
        catch (error) {
            console.error('Failed to start session:', error);
            alert('Failed to start session');
        }
        finally {
            setStarting(false);
        }
    };
    const handleLogout = async () => {
        try {
            await signOut();
            onLogout();
        }
        catch (error) {
            console.error('Logout failed:', error);
        }
    };
    const getCategoryColor = (category) => {
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
    return (_jsxs("div", { className: "home-screen", children: [_jsxs("header", { className: "home-header", children: [_jsx("h1", { children: "PRT Virtual Gym" }), _jsxs("div", { className: "header-actions", children: [_jsx("span", { className: "user-email", children: user?.email }), _jsx("button", { onClick: handleLogout, className: "logout-button", children: "Sign Out" })] })] }), _jsxs("main", { className: "home-content", children: [_jsxs("section", { className: "start-session-section", children: [_jsx("h2", { children: "Start a Session" }), _jsxs("div", { className: "session-buttons", children: [_jsx("button", { onClick: () => handleStartSession('saturday_prt'), disabled: starting, className: "primary-button large", children: starting ? 'Starting...' : 'Start Saturday PRT' }), _jsx("button", { onClick: () => handleStartSession('practice'), disabled: starting, className: "secondary-button large", children: starting ? 'Starting...' : 'Start Practice Session' })] })] }), _jsxs("section", { className: "recent-sessions-section", children: [_jsx("h2", { children: "Recent Sessions" }), loading ? (_jsx("p", { children: "Loading sessions..." })) : sessions.length === 0 ? (_jsx("p", { children: "No sessions yet. Start your first PRT!" })) : (_jsx("div", { className: "sessions-list", children: sessions.map((session) => (_jsxs("div", { className: "session-card", style: {
                                        borderLeftColor: session.kind === 'saturday_prt' ? '#3b82f6' : '#6b7280'
                                    }, children: [_jsx("div", { className: "session-date", children: new Date(session.started_at).toLocaleDateString() }), _jsx("div", { className: "session-kind", children: session.kind === 'saturday_prt' ? '🏋️ Saturday PRT' : '📝 Practice' }), _jsx("div", { className: "session-state", children: session.state === 'completed' ? '✓ Completed' : 'In Progress' })] }, session.session_id))) }))] })] })] }));
}
