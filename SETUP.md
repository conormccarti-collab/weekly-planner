# Setup (Stage 1)

One-time manual steps. Nothing here is automatable — they're account/console actions in Supabase and Google Cloud.

## 1. Supabase project

1. Create a Supabase project (supabase.com) for this app.
2. Project Settings → API → copy the Project URL, `anon` key and `service_role` key into `.env.local` (copy `.env.example` first).
3. Run the migration in `supabase/migrations/0001_stage1_init.sql` against the project — either via the SQL Editor in the dashboard, or with the Supabase CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

## 2. Google Cloud OAuth client

In the "personal assistant" Google Cloud project (already created in the work Workspace):

1. **APIs & Services → Library**: enable the **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: set User type to **Internal**. Add scopes:
   - `.../auth/userinfo.email`
   - `.../auth/calendar.readonly`
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type **Web application**.
   - Authorized redirect URI: the callback URL Supabase shows you in the next step (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
4. Copy the generated **Client ID** and **Client secret**.

## 3. Wire Google into Supabase Auth

In the Supabase dashboard → Authentication → Providers → Google:

1. Enable the provider, paste the Client ID and Client secret from step 2.
2. Under "Authorized Client IDs" / scopes, make sure `calendar.readonly` is allowed — the app requests it at sign-in time (`app/login/sign-in-button.tsx`), but some Supabase projects also need it listed here.
3. Set the Site URL and Redirect URLs (Authentication → URL Configuration) to include:
   - `http://localhost:3000/auth/callback` (dev)
   - `https://<your-vercel-domain>/auth/callback` (prod, once deployed)

## 4. Local env

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from step 1.
- `ALLOWED_EMAIL` — the work Google account that owns the calendar.
- `ENCRYPTION_KEY` — `openssl rand -base64 32`.
- Leave `ASANA_PAT`, `ASANA_WORKSPACE_GID`, `ANTHROPIC_API_KEY` blank for now; they're not used until later stages.

## 5. Run it

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. You should be redirected to `/login`; "Continue with Google" should sign you in only if the account matches `ALLOWED_EMAIL`, and settings should persist on reload.

### Note on token expiry (brief, section 3)

Because the consent screen is Internal to the Workspace, refresh tokens do not expire after 7 days the way External/Testing-mode tokens do. If that ever changes (app moved to a personal Google account, or set to External + Testing), `calendar.readonly` sync will start failing silently after a week — Stage 3 adds the "Reconnect calendar" detection for that case.

### Running a new migration

New `supabase/migrations/*.sql` files aren't applied automatically — there's no CI/CD wired up yet. Each one needs a direct Postgres connection (the anon/service-role keys only cover row-level CRUD via the REST API, not schema changes):

1. Get the connection string from the Supabase dashboard → **Connect** button (top of the project page, not Project Settings) → **Session pooler** (works over IPv4; Direct connection needs IPv6) → copy the URI.
2. Add it to `.env.local` as `SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres`.
3. Run the new migration file against that connection (e.g. a short Node script using the `pg` package), then run `NOTIFY pgrst, 'reload schema';` against the same connection — PostgREST caches the schema and won't see new tables/columns until it's told to reload.

### Asana credentials

`ASANA_PAT` and `ASANA_WORKSPACE_GID` are reused from the old personal-pa project's token. Get your own from `https://app.asana.com/0/my-apps` (Personal Access Token) and the workspace GID from the Asana API Explorer if that token is ever revoked.
