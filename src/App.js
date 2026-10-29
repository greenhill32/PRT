import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import './App.css';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import SessionScreen from './screens/SessionScreen';
import { getCurrentUser, onAuthStateChange } from './supabase';
import { setupNetworkWatcher, cleanupSync } from './sync';
import { initDB } from './queue';
function App() {
    const [state, setState] = useState({
        user: null,
        currentScreen: 'auth',
        sessionId: null
    });
    useEffect(() => {
        const initialize = async () => {
            // Initialize IndexedDB
            await initDB();
            // Check current user
            const user = await getCurrentUser();
            setState((prev) => ({
                ...prev,
                user,
                currentScreen: user ? 'home' : 'auth'
            }));
            // Setup auth state listener
            const { data: { subscription } } = onAuthStateChange((user) => {
                setState((prev) => ({
                    ...prev,
                    user,
                    currentScreen: user ? 'home' : 'auth'
                }));
            });
            // Setup sync listeners
            setupNetworkWatcher((count) => {
                // Update UI with queued count if needed
                if (count > 0) {
                    console.log(`${count} events queued for sync`);
                }
            });
            return () => {
                subscription?.unsubscribe();
                cleanupSync();
            };
        };
        initialize().catch(console.error);
    }, []);
    const handleStartSession = (sessionId) => {
        setState((prev) => ({
            ...prev,
            currentScreen: 'session',
            sessionId
        }));
    };
    const handleEndSession = () => {
        setState((prev) => ({
            ...prev,
            currentScreen: 'home',
            sessionId: null
        }));
    };
    const handleLogout = async () => {
        setState((prev) => ({
            ...prev,
            user: null,
            currentScreen: 'auth'
        }));
    };
    return (_jsxs("div", { className: "app", children: [state.currentScreen === 'auth' && _jsx(AuthScreen, {}), state.currentScreen === 'home' && (_jsx(HomeScreen, { user: state.user, onStartSession: handleStartSession, onLogout: handleLogout })), state.currentScreen === 'session' && state.sessionId && (_jsx(SessionScreen, { sessionId: state.sessionId, onEndSession: handleEndSession }))] }));
}
export default App;
