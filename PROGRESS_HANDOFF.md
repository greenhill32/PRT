# Progress page handoff

Repository: https://github.com/greenhill32/PRT
Branch: codex/prt-progress-league

## Implemented

- A Progress page linked from Home, with Session, Week, Month, Year and All time views. Month is the default.
- Saving a completed workout opens that session's Progress view. Existing saved session leaderboards remain accessible.
- Summary cards, event latest/average/best/change, PRT/push-ups/plank/rowing charts, session-frequency bars, recorded push-up/plank totals and 2km-per-row distance.
- Cumulative league for You, Peer, Steady, Volatile and Rival. Finishing positions earn 5/4/3/2/1 points. Tied finishers share the points for occupied places; joint firsts count as wins. Practice and Ghost You are excluded from league points.
- Practice is opt-in for personal progress. Incomplete/invalid or unsupported-scoring records are flagged and excluded from composite averages and league points. No invented calories or workout duration.
- UK calendar periods (Europe/London), Monday weeks, correct daylight-saving boundaries, previous-period comparisons, date navigation and a saved-session picker.
- Full paginated completed-session/event loading, independent of the ten-item Recent Sessions list. Server row caps are handled by reading every actual page.
- An account-specific complete-history snapshot for offline use, explicitly labelled with its saved date. The local IndexedDB upgrade preserves existing queue/cache stores. No Supabase schema migration is required for this feature.
- Shared per-session leaderboard ranks now reflect ties consistently in the app and coach.

## Validation

Local tests and the production build have been run. Coverage includes UK DST/calendar boundaries, corrections/zero values, full pagination, account-isolated offline snapshots, fair league ties, practice exclusion, UI filters, retries and the save-to-Progress handoff.

The tests use fixtures/mocked external services. Live account data and real iPhone/Safari behaviour remain deployment checks.

## Remaining work in the configured environment

1. Review this feature PR against current main, preserve any newer changes, run npm ci, npm test and npm run build, and merge when verified.
2. Deploy the frontend through Vercel. There are no new frontend environment variables or Supabase tables for Progress.
3. Redeploy the coach function as well: it imports the shared leaderboard module whose tie ranking changed. Keep its existing secrets and origin configuration.
4. With the real account, check Month/Year/All time counts against completed sessions, including history beyond ten rows. Verify averages from raw events and stored competitor snapshots; never regenerate historical opponents.
5. Confirm saved sessions open under Session, Save opens Progress after successful upload/completion, and charts/league/date controls work on iPhone/Safari.
6. Exercise offline refresh after a full online load, then reconnect and refresh. Confirm the offline saved-date notice and preservation of any pending workout queue.
7. Check that UK midnight/DST boundaries select the expected sessions. Confirm tied places share points, practice never contributes to league points, and incomplete legacy sessions are labelled rather than given fabricated scores.
8. The earlier completion-policy repair (migration 003) still needs to be deployed if it has not already been applied. Do not rerun migration 001, reset the database, or delete existing history.

Report the commit/deployment verified, tests actually performed and any remaining blockers. Keep deployment claims separate from local verification.
