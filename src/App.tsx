import { useState, useEffect } from 'react';
import './App.css';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import SessionScreen from './screens/SessionScreen';
import { getCurrentUser, onAuthStateChange } from './supabase';
import { setupNetworkWatcher, cleanupSync } from './sync';
import { initDB } from './queue';

type Screen = 'auth' | 'home' | 'session';

interface AppState {
  user: any | null;
  currentScreen: Screen;
  sessionId: string | null;
}

function App() {
  const [state, setState] = useState<AppState>({
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

  const handleStartSession = (sessionId: string) => {
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

  return (
    <div className="app">
      {state.currentScreen === 'auth' && <AuthScreen />}
      {state.currentScreen === 'home' && (
        <HomeScreen
          user={state.user}
          onStartSession={handleStartSession}
          onLogout={handleLogout}
        />
      )}
      {state.currentScreen === 'session' && state.sessionId && (
        <SessionScreen
          sessionId={state.sessionId}
          onEndSession={handleEndSession}
        />
      )}
    </div>
  );
}

export default App;
