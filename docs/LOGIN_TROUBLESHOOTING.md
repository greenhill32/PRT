# Login failure checklist

The page loads, so the bundle runs and both `VITE_` variables were present at build
time. The client needs a valid URL and key for a live, unpaused project, and the
account must be confirmed. Work through these in order. Do not change production
secrets or auth policies until the failing check is confirmed.

## How the app calls Supabase

- `src/supabase.ts` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  and creates the client. Missing values throw "Missing Supabase environment
  variables" at load time, so a page that loads has both set in that build.
- `src/screens/AuthScreen.tsx` calls `signInWithPassword` and shows the raw
  `err.message`. Expect these messages:
  - `Invalid login credentials`: wrong password, or no such account.
  - `Email not confirmed`: sign-up done, confirmation link not clicked.
  - `Failed to fetch` / network error: wrong URL, project paused, or blocked request.
  - `Email rate limit exceeded` / `over_request_rate_limit`: wait and retry.

## 1. Read the actual error

Open the live site, DevTools → Network, filter `token?grant_type=password`, and submit
the form. Note the HTTP status and the JSON `error_code` / `msg`. This identifies
which branch below applies. Do not paste the anon/publishable key or any password
into an issue or chat.

## 2. Supabase dashboard (project owner)

- **Project status:** Healthy, not Paused. A paused project makes every auth call fail.
  See `docs/SUPABASE_KEEPALIVE.md` for safe resume steps.
- **Project URL:** Settings → API. Its `<ref>` must match the `VITE_SUPABASE_URL` the
  Vercel build uses. A URL from another project logs in against an empty database.
- **Publishable key:** Settings → API → publishable key. It must be the same project's
  key. Use the publishable key here, never the secret/service key. A secret key in the
  frontend is a serious exposure and must be rotated.
- **Authentication → Users:** the account exists and is **confirmed**. If it is not
  confirmed, confirm it, or resend the confirmation email. Do not disable confirmation
  just to get past this step.
- **Authentication → Providers → Email:** enabled, and password sign-in is allowed.
- **Authentication → URL Configuration:** the **Site URL** is the production Vercel
  origin (currently `https://prt-brown-eta.vercel.app`, per `DEPLOY_HANDOFF.md`), and
  it is listed in **Redirect URLs**. A wrong Site URL sends confirmation links to
  `localhost`, so the account never confirms.
- **Logs → Auth:** shows the server-side reason for each failed attempt.

## 3. Vercel project settings

- **Settings → Environment Variables:** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` are set for the **Production** environment (not only
  Preview or Development). Values have no quotes, no trailing spaces or newlines.
- Vite inlines these at build time. After changing them, **redeploy** the production
  deployment. Changing the value without a new build changes nothing.
- **Deployments:** the production deployment is the commit you expect and is "Ready".
- If the old build keeps appearing after a fix, the PWA service worker may be serving a
  cached bundle. Hard-reload, or unregister the service worker in DevTools → Application.

## 4. Code-side checks (already reviewed)

- The auth implementation uses the same client for sign-in, sign-up and session
  restore (`getSession`, `onAuthStateChange`). No hard-coded URL or key appears in `src/`.
- `.env` and `.env.local` are gitignored. The committed `.env.example` contains the
  project's publishable key, which is designed to be public.

## Not to do without verification

- Do not change Supabase auth policies (confirmation requirement, providers, RLS).
- Do not rotate or replace production keys before confirming which value is wrong.
- Do not create a second Supabase project to "fix" login. That would split the data.
