// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProgressScreen from './ProgressScreen';
import { getProgressHistory } from '../progressData';
import { savedSession, savedEvents } from '../test/progressFixtures';
vi.mock('../progressData', () => ({ getProgressHistory: vi.fn() }));
const sessions = [
  savedSession('sep', '2026-09-05T10:00:00Z'), savedSession('oct1', '2026-10-03T10:00:00Z'),
  savedSession('oct2', '2026-10-10T10:00:00Z'), savedSession('practice', '2026-10-11T10:00:00Z', 'practice')
];
const history = { sessions: [...sessions].reverse(), events: sessions.flatMap(s => savedEvents(s)), fetchedAt: '2026-10-29T12:00:00Z', source: 'server' as const };
const count = () => within(screen.getByText('Sessions recorded').closest('article')!).getByText(/^\d+$/).textContent;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  vi.mocked(getProgressHistory).mockReset().mockResolvedValue(history);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Progress page', () => {
  it('defaults to this month and changes Year/All time without truncating history', async () => {
    render(<ProgressScreen userId="owner" onBack={() => {}} onViewSession={() => {}} />);
    await screen.findByText('October 2026');
    await screen.findByText('Sessions recorded');
    expect(count()).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    expect(count()).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(count()).toBe('3');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include practice' }));
    expect(count()).toBe('4');
    expect(getProgressHistory).toHaveBeenCalledTimes(1);
  });
  it('opens a selected session and lets the user return to the saved leaderboard', async () => {
    const onViewSession = vi.fn();
    render(<ProgressScreen userId="owner" initialSessionId="oct2" onBack={() => {}} onViewSession={onViewSession} />);
    await screen.findByText('Final leaderboard');
    expect(screen.getByLabelText('Saved session')).toHaveProperty('value', 'oct2');
    fireEvent.click(screen.getByRole('button', { name: /10 Oct 2026 Saturday PRT/ }));
    expect(onViewSession).toHaveBeenCalledWith('oct2');
  });
  it('labels an offline snapshot and shows an honest empty state', async () => {
    vi.mocked(getProgressHistory).mockResolvedValue({ ...history, source: 'cache', sessions: [], events: [] });
    render(<ProgressScreen userId="owner" onBack={() => {}} onViewSession={() => {}} />);
    await screen.findByText(/Offline snapshot/);
    expect(screen.getByText('Your progress starts with one session.')).toBeTruthy();
  });
  it('shows fetch failures and supports retry', async () => {
    vi.mocked(getProgressHistory).mockRejectedValueOnce(new Error('Connect once to load history.'));
    render(<ProgressScreen userId="owner" onBack={() => {}} onViewSession={() => {}} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Sessions recorded');
    expect(count()).toBe('2');
  });
});
