# Deploying Dev Resolve — frontend on Vercel, backend on Railway

```
browser ──► Vercel  (apps/web: pages only)
               │  /api/* and /dev-resolve-connector.mjs are forwarded ─────────┐
               ▼                                                                ▼
           (same domain for the browser: cookies, Google sign-in just work)  Railway (apps/api: API, agent,
                                                                              connector relay, Python tools)
Chrome extension ──────────────────────────────────────────────────────────► Railway directly
                                                                              + Railway Postgres + volume /data
```

The browser only ever talks to the Vercel domain; Vercel forwards `/api` to Railway. So there is no CORS and no
cross-domain cookie setup. Each user's Chrome extension talks to Railway directly (long-polls).

## 1. Railway — backend (`apps/api`)

1. **New Project → Deploy from GitHub repo** → this repo. In the service → **Settings**:
   - **Root Directory:** `apps/api` (it builds `apps/api/Dockerfile`; `railway.json` sets health check + 1 replica)
   - **Networking → Generate Domain** → note it, e.g. `https://dev-resolve-api.up.railway.app`
2. **+ New → Database → PostgreSQL** in the same project.
3. *(Optional)* Service → **Volumes → New Volume** at **`/data`** — only caches the synced code. Config, knowledge and
   each person's sign-ins are kept **in Postgres**, so nothing is lost on redeploys even without a volume.
4. Service → **Variables** (see `apps/api/.env.example`):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference) |
| `DATABASE_SSL` | `off` (private network) |
| `NODE_ENV` | `production` |
| `DEV_RESOLVE_CONNECTOR` | `on` |
| `APP_URL` | the **Vercel** URL (step 2), e.g. `https://dev-resolve.vercel.app` |
| `BACKEND_PUBLIC_URL` | the Railway domain from step 1 |
| `DEVREV_TOKEN`, `DEVREV_BASE_URL`, `DEVREV_APP_URL` | from your `.env.local` |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` (or `ANTHROPIC_API_KEY`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | your OAuth client |
| `GOOGLE_ALLOWED_DOMAINS`, `GOOGLE_ADMIN_EMAILS` | your company domain, your email |
| `CODE_GIT_BASE`, `GITHUB_TOKEN` | `https://github.com/<org>`, fine-grained read-only token |

Railway sets `PORT` itself. Logs on start print `[settings] {…}` — check the URLs there.

## 2. Vercel — frontend (`apps/web`)

1. **Add New → Project** → this repo → **Root Directory:** `apps/web` (framework: Next.js, detected).
2. **Environment Variables:** `BACKEND_URL` = the Railway domain (e.g. `https://dev-resolve-api.up.railway.app`).
3. Deploy. Its URL (or your custom domain) is the `APP_URL` you set on Railway — update it there if it changed,
   and redeploy the backend.

## 3. Google sign-in

In the OAuth client add the redirect URI **`<APP_URL>/api/auth/google/callback`** (the Vercel domain).

## 4. Private files (once, by an admin)

They're stored in the backend's Postgres from then on. Either:
- **Settings** page (Vercel URL → Sign in with Google → Settings): upload `apps/api/config/projects.json`, `config.env`,
  and the knowledge archive (`npm --prefix apps/api run pack-knowledge` → `knowledge-upload.tgz`), or
- one command from your laptop: `npm --prefix apps/api run private -- push "<Railway Postgres DATABASE_PUBLIC_URL>"`,
  then redeploy the backend.

## 5. Each user — once per laptop

**Connector** page → **Download the extension** → unzip → `chrome://extensions` → *Developer mode* → **Load unpacked**.
It links itself to the signed-in person and runs whenever Chrome is open. After that a user only connects the client VPN
and signs in with Google; Metabase / app-logs Google sign-ins are picked up from their Chrome. (A terminal connector
exists as a fallback for people without Chrome.)

## Local

```bash
npm run install:all     # once
npm run up              # Postgres + backend :3002 + frontend :3001 → http://localhost:3001
npm run user -- list    # logins
```

Other details (database roles, backups, logins, connector, code sync): `apps/api/DEPLOY.md`.
