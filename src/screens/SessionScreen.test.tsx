// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import * as api from '../supabase';
import { clearQueue, queueEvent, getQueuedEventsBySession } from '../queue';
import SessionScreen from './SessionScreen';

vi.mock('../supabase', () => ({
  getSession: vi.fn(), getSessionEvents: vi.fn(), callCoach: vi.fn()
}));
vi.mock('../sync', () => ({
  syncQueue: vi.fn(async () => ({ synced: 0, failed: 0, errors: [] })),
  completeSession: vi.fn(async () => {})
}));
const result = { pushups: 38, plank: 122, row_2k: 530 };
const session: any = { session_id: 'session', user_id: 'owner', scoring_version: '1.0',
  kind: 'saturday_prt', state: 'in_progress',
  competitor_snapshot: { peer: result, steady: result, volatile: result, rival: result, ghost_you: null } };
const event: any = { event_id: 'event', session_id: 'session', event_type: 'pushups',
  raw_value: 38, unit: 'reps', timestamp: '2026-10-29T12:00:00Z', created_at: '2026-10-29T12:00:00Z',
  source: 'app', detail: null, correction_of: null, voids_event_id: null };

beforeEach(async () => {
  await clearQueue();
  vi.mocked(api.getSession).mockResolvedValue(session);
  vi.mocked(api.getSessionEvents).mockResolvedValue([]);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
afterEach(cleanup);

describe('Session resume', () => {
  it('restores synced event reveals and advances to plank', async () => {
    vi.mocked(api.getSessionEvents).mockResolvedValue([event]);
    const { container } = render(<SessionScreen sessionId="session" onEndSession={() => {}} />);
    await screen.findByText('Enter plank');
    expect(container.querySelector('.score-large')?.textContent).toBe('70');
    expect(container.querySelectorAll('.leaderboard tbody tr')[1].textContent).toContain('38 (70)');
  });
  it('restores unsynced raw values after unmount/remount while offline', async () => {
    await queueEvent({ ...event, user_id: 'owner', status: 'error' });
    const view = render(<SessionScreen sessionId="session" onEndSession={() => {}} />);
    await screen.findByText('Enter plank');
    fireEvent.change(screen.getByPlaceholderText('e.g., 2:02 or 122'), { target: { value: '2:02' } });
    await act(async () => { fireEvent.click(screen.getByText('Confirm', { exact: true })); });
    await screen.findByText('Enter row 2k');
    expect((await getQueuedEventsBySession('session')).length).toBe(2);
    view.unmount();
    const reopened = render(<SessionScreen sessionId="session" onEndSession={() => {}} />);
    await screen.findByText('Enter row 2k');
    expect(reopened.container.querySelector('.score-large')?.textContent).toBe('70');
    await waitFor(() => expect(screen.getByText('2 unsynced')).toBeTruthy());
  });
  it('opens this session in Progress after saving successfully', async () => {
    vi.mocked(api.getSessionEvents).mockResolvedValue(['pushups', 'plank', 'row_2k'].map((type, index) => ({ ...event, event_id: type, event_type: type, raw_value: [38, 122, 530][index] })) as any);
    const onViewProgress = vi.fn(), onEndSession = vi.fn();
    render(<SessionScreen sessionId="session" onEndSession={onEndSession} onViewProgress={onViewProgress} />);
    await screen.findByText(/All three events confirmed/);
    await act(async () => { fireEvent.click(screen.getByText('Save Session')); });
    expect(onViewProgress).toHaveBeenCalledWith('session');
    expect(onEndSession).not.toHaveBeenCalled();
  });
  it('does not show a leaderboard in practice sessions', async () => {
    vi.mocked(api.getSession).mockResolvedValue({ ...session, kind: 'practice', competitor_snapshot: {} });
    render(<SessionScreen sessionId="session" onEndSession={() => {}} />);
    await screen.findByText('Enter pushups');
    expect(screen.queryByText('Leaderboard')).toBeNull();
  });
});
