import { useState, useEffect } from 'react';
import './App.css';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import SessionScreen from './screens/SessionScreen';
import { getCurrentUser, onAuthStateChange } from './supabase';
import { setupNetworkWatcher, cleanupSync } from './sync';
import { initDB } from './queue';

type Screen = 'auth' | 'home' | 'session';
interface AppState { user: any | null; currentScreen: Screen; sessionId: string | null }

export default function App() {
  const [state, setState] = useState<AppState>({ user: null, currentScreen: 'auth', sessionId: null });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const setUser = (user: any) => {
      if (cancelled) return;
      setState(previous => {
        const sameUser = user && previous.user?.id === user.id;
        return {
          user, currentScreen: sameUser ? previous.currentScreen : user ? 'home' : 'auth',
          sessionId: sameUser ? previous.sessionId : null
        };
      });
    };
    const initialize = async () => {
      await initDB();
      if (cancelled) return;
      const { data: { subscription } } = onAuthStateChange(setUser);
      unsubscribe = () => subscription.unsubscribe();
      setUser(await getCurrentUser());
      if (!cancelled) setupNetworkWatcher(() => {});
    };
    void initialize().catch(console.error);
    return () => { cancelled = true; unsubscribe?.(); cleanupSync(); };
  }, []);

  const startSession = (sessionId: string) => setState(previous => ({
    ...previous, currentScreen: 'session', sessionId
  }));
  const endSession = () => setState(previous => ({ ...previous, currentScreen: 'home', sessionId: null }));
  return <div className="app">
    {state.currentScreen === 'auth' && <AuthScreen />}
    {state.currentScreen === 'home' && <HomeScreen user={state.user} onStartSession={startSession}
      onLogout={() => setState({ user: null, currentScreen: 'auth', sessionId: null })} />}
    {state.currentScreen === 'session' && state.sessionId &&
      <SessionScreen key={state.sessionId} sessionId={state.sessionId} onEndSession={endSession} />}
  </div>;
}
