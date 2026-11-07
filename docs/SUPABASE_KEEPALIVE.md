# Supabase keepalive

Supabase Free projects can be paused after a period of inactivity. The workflow
`.github/workflows/supabase-keepalive.yml` runs `scripts/supabase-keepalive.mjs`
four times a day to make a small, authenticated, read-only database query.

## Limits you should know about

- **Not guaranteed.** Scheduled GitHub Actions runs can be delayed or skipped under
  load. Supabase's inactivity rules can change. This workflow reduces the risk of
  pausing; it does not prevent it.
- **GitHub disables schedules** on repositories with no commits for about 60 days.
  Check the Actions tab if the heartbeat stops running.
- The workflow fails visibly (red run) when sign-in or the read fails after
  retries. Subscribe to failure notifications on the repository.

## What it does

1. Signs in with the publishable key and a dedicated heartbeat user's credentials.
2. Runs `GET /rest/v1/sessions?select=session_id&limit=1`.

It never inserts, updates or deletes rows. It uses no service-role key. Row Level
Security limits the read to the heartbeat user's own rows, which are none if that
user owns no sessions.

Retries: up to 4 attempts with 2s, 4s and 8s backoff, only for network errors,
HTTP 429/5xx and non-JSON responses. Bad credentials (4xx) fail on the first attempt.

## One-time setup (manual)

1. **Create a heartbeat user** in Supabase: Authentication → Users → Add user.
   Use a dedicated address you control. Confirm the email, or the sign-in will fail
   with "Email not confirmed". Do not use Lee's own account. It must never be
   granted any data.
2. **Add repository secrets** in GitHub: Settings → Secrets and variables → Actions:
   - `SUPABASE_URL`: the project URL, e.g. `https://<ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the publishable (anon) key
   - `KEEPALIVE_EMAIL`: the heartbeat user's email
   - `KEEPALIVE_PASSWORD`: the heartbeat user's password

   Never put these values in code, commits, logs or issue comments.

## Testing

Locally, the unit tests use a mocked fetch and need no network:

```bash
npx vitest run scripts
```

Manually in GitHub: Actions → "Supabase keepalive" → Run workflow. A passing run logs
`Supabase heartbeat OK: authenticated read-only query returned N row(s).`
A failing run logs the HTTP status or network error, never a credential.

## If the project is already paused

Do not run the workflow first. Resume the project before testing:

1. Open the Supabase dashboard for the project and sign in as the project owner.
2. If the project shows **Paused** or **Restore project**, choose **Restore**
   (or **Resume**). Wait until its status is **Healthy**. This does not delete data.
3. Check **Settings → General** for the expected project URL and reference.
4. Confirm the sign-in on the live site works (see `docs/LOGIN_TROUBLESHOOTING.md`).
5. Then run the workflow manually and check that it passes.

Do not create a new project or reset the database to recover from a pause. That would
create a second, empty database and orphan the existing workout history.
