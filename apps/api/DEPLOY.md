# Backend details (apps/api)

For the Vercel + Railway setup see the top-level DEPLOY.md. This file covers the backend in depth.

One container (Node 22 + Python 3 + git), one Postgres, HTTPS in front. The image holds **code only** — private
config, knowledge and sign-ins live on the `/data` volume; secrets come from the environment.

## 1. What goes where

| What | Where | Notes |
|---|---|---|
| Secrets (DevRev, Claude, DB, GitHub) | secrets manager → container env (`.env.example` lists them) | never in the repo or image |
| `config/projects.json`, `config/config.env` | `/data/config/` on the volume | copy from your laptop once (`docker cp`) |
| Knowledge base | `/data/knowledge/` | templates are seeded on first start; copy your `knowledge/<account>/` folders |
| Each person's Google sign-ins | `/data/auth/users/<name>/` | written by their local connector, readable by the app only |
| Code the agent reads | `/data/code/` | cloned/updated from GitHub every 30 min |

## 2. Database

Managed Postgres 16 (RDS / Cloud SQL) with automated backups is recommended. Then:

```bash
psql "$ADMIN_URL" -v owner_pw="'…'" -v app_pw="'…'" -f db/roles.sql    # two roles: owner (migrations) + app (data only)
```

`DATABASE_URL` = the app role, `MIGRATION_DATABASE_URL` = the owner role, `DATABASE_SSL=verify-full` +
`DATABASE_CA_CERT` for managed Postgres. Migrations run automatically on every start. Self-hosted Postgres: schedule
`scripts/db-backup.sh` nightly.

## 3. Logins

**Sign in with Google** (recommended). In Google Cloud Console → APIs & Services → Credentials → *Create OAuth
client ID* → **Web application**:
- Authorized redirect URI: `https://<your-domain>/api/auth/google/callback`
- OAuth consent screen: **Internal** (only your Google Workspace users)

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAINS=<your company domain>` (falls back to
`SSO_ACCOUNT_DOMAIN`) and `GOOGLE_ADMIN_EMAILS=<you>` — in the environment or in `config/config.env`.
For local testing also add `http://localhost:3001/api/auth/google/callback` as a redirect URI. People of that domain get a member login on first sign-in
(`GOOGLE_AUTO_CREATE=off` to allow only people you add with `npm run user -- add-google <email>`).
Password logins stay as a break-glass; `DEV_RESOLVE_PASSWORD_LOGIN=off` hides them.

```bash
docker compose exec app npm run user -- add <name> --admin     # asks for the password (hidden, 12+ chars)
docker compose exec app npm run user -- list | reset | disable | enable | signout
```

Passwords are stored hashed (scrypt); sessions are server-side, so sign-out / disable / reset is immediate.
5 wrong passwords lock an account for 15 minutes. Only admins can switch clients on/off.

## 4. Client VPN and Google sign-in — the local connector

The server can't join the client VPN and can't do Google sign-in. With `DEV_RESOLVE_CONNECTOR=on`, each person runs the
connector on their own laptop (Dev Resolve → **Connector** page shows the one-line command):

- requests to VPN-only hosts (`VPN_HOST_SUFFIXES`) from *their* investigations go through *their* laptop (on the VPN);
- Google-login Metabase and app logs are signed in in *their* Chrome; only the session is sent, stored for them only.

Needs Node 22+ and Chrome on the laptop. The connector pins the allowed host suffix on first run and only does GET/POST.

## 5. Code access

`CODE_GIT_BASE=https://github.com/<org>`, `GITHUB_TOKEN` = fine-grained token, **read-only Contents** on only the
repos in `code_repos`. Shallow clones; the token is sent per request, never stored in git config.

## 6. Run on any Docker host (instead of Railway)

```bash
docker compose -f docker-compose.prod.yml --env-file /secure/dev-resolve.env up -d --build
# first start only — the app waits until these are on the volume:
docker cp config/projects.json <container>:/data/config/ && docker cp config/config.env <container>:/data/config/
docker cp knowledge/. <container>:/data/knowledge/        # your accounts' playbooks / saved queries
curl -fsS https://<host>/api/healthz        # {"ok":true} — for the load balancer
```

Run **one** instance (the connector relay and Metabase rate limit are in memory). Put TLS in front; set `APP_URL`
to the public URL.
