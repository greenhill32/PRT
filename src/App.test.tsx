// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import App from './App';
import { onAuthStateChange } from './supabase';
import { cleanupSync } from './sync';

vi.mock('./queue', () => ({ initDB: vi.fn(async () => ({})) }));
vi.mock('./sync', () => ({ setupNetworkWatcher: vi.fn(), cleanupSync: vi.fn() }));
vi.mock('./supabase', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'owner' })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
}));
vi.mock('./screens/ProgressScreen', () => ({ default: () => <div>Progress view</div> }));
vi.mock('./screens/AuthScreen', () => ({ default: () => <div>Sign in screen</div> }));
vi.mock('./screens/HomeScreen', () => ({ default: ({ onStartSession }: any) =>
  <button onClick={() => onStartSession('session')}>Open workout</button> }));
vi.mock('./screens/SessionScreen', () => ({ default: () => <div>Active workout</div> }));
afterEach(cleanup);

describe('Auth lifecycle', () => {
  it('keeps the workout open on same-user token refresh and cleans up on unmount', async () => {
    const view = render(<App />);
    fireEvent.click(await screen.findByText('Open workout'));
    expect(screen.getByText('Active workout')).toBeTruthy();
    const callback = vi.mocked(onAuthStateChange).mock.calls[0][0];
    act(() => callback({ id: 'owner' }));
    expect(screen.getByText('Active workout')).toBeTruthy();
    const subscription = vi.mocked(onAuthStateChange).mock.results[0].value.data.subscription;
    view.unmount();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(cleanupSync).toHaveBeenCalled();
  });
});
