---
name: reliance-metabase-query
description: Run read-only SQL queries against Reliance Metabase instances — WMS/QC (vf-wms-metabase.ril.com — QC PSQL Prod Slave id 6, Reliance VF replica DB id 2) and JioMart 3P (shipsy-wms-metabase.ril.com — PROD-Slave id 2, PROD Packing id 6), selected via --project — directly from Claude Code, instead of asking the user to paste query results. Use whenever debugging a Reliance/JioMart WMS, Quick Commerce/JioMart darkstore (QC), or JioMart 3P incident needs a live DB check (gate pass, ASN, GRN, PO status, etc.) and the Metabase session is authenticated.
---

# Reliance Metabase Query

A small CLI (`query.py` in this skill directory) that talks to the Metabase
HTTP API directly, so DB-level checks during Reliance incident debugging
don't require the user to run SQL themselves and paste back results. Covers
multiple Reliance products/Metabase instances, selected via `--project` —
**configured dynamically from `Dev Resolve's config/ folder projects.json`**,
not hardcoded in this script. Adding a new project is pure data entry (edit
`projects.json` + `config.env`), no code change — full steps in
`Dev Resolve's README.md ("Adding an account")`. Run `query.py projects` for the
live, current list — don't rely on a hardcoded list from memory, since new
projects can be added at any time.

**This tool is read-only. It must never be used to write, modify, or delete
any data.** The script itself refuses non-SELECT/WITH queries and any query
containing a write/DDL keyword (see "Read-only enforcement" below) — do not
attempt to work around that refusal. Only ever run `SELECT`/`WITH` queries
against any of these Metabase instances.

All config, credentials, and session state live in one consolidated folder:
`Dev Resolve's config/ folder ` (outside any git repo, mode 700/600) — never in
this project directory, never committed anywhere. This same folder is shared
with the `reliance-opensearch-logs` MCP server (`config.env` holds every
project's endpoints and credentials).

## Projects — separate Metabase instances, separate databases

| `--project` | Metabase host | Databases (`--database`) |
|---|---|---|
| `wms` (default) | vf-wms-metabase.ril.com | Reliance VF: `2` — vf-replica-db (Postgres), `3` — vf-prod-mongodb (Mongo). QC: `6` — qc-psql-prod-slave (Postgres, default for this project), `7` — qc-prod-mongodb (Mongo) |
| `jiomart_3p` | shipsy-wms-metabase.ril.com | `2` — PROD-Slave (Postgres, default for this project), `6` — PROD Packing (Postgres) |

Database ids **collide across projects** (e.g. `2` means something different
in `wms` vs `jiomart_3p`) — always pass `--project` once you know which
Reliance product the incident belongs to, don't rely on the default (`wms`).
Within `wms`, Reliance VF and QC are further separate tenants — see the
tenant note below.

Confirm the project/tenant from the incident (warehouse code; "QC"/"quick
commerce" vs "Reliance"/"JioMart WMS" vs "JioMart 3P" mentioned explicitly;
ask if ambiguous) before querying.

## First-time setup (once per machine, per project you use)

Check whether a session is already stored and valid for a project (default `wms`):

```sh
python3 .claude/skills/reliance-metabase-query/query.py whoami --project wms
python3 .claude/skills/reliance-metabase-query/query.py whoami --project jiomart_3p
```

If either prints `401 Unauthorized` or "No session token stored" for that project:

- **Preferred (auto-refresh):** the user runs this themselves in their own
  terminal (never paste a password into chat) — prompts for username/password
  via hidden input, stores them in `Dev Resolve's config/ folder config.env`
  under that project's own keys, and every future 401 for that project
  auto-refreshes without asking again:
  ```sh
  python3 .claude/skills/reliance-metabase-query/query.py set-credentials --project wms
  python3 .claude/skills/reliance-metabase-query/query.py set-credentials --project jiomart_3p
  ```
- **One-off session only:** interactive login (neither username nor password
  is retained — only the resulting session id is kept):
  ```sh
  python3 .claude/skills/reliance-metabase-query/query.py login --project jiomart_3p
  ```
- **Or paste an existing session cookie:**
  ```sh
  python3 .claude/skills/reliance-metabase-query/query.py set-session <metabase.SESSION cookie value> --project jiomart_3p
  ```

Sessions expire after ~14 days, independently per project — with
`set-credentials` done once per project, expiry is handled automatically;
otherwise re-run `login` for that project.

## Running queries

```sh
python3 .claude/skills/reliance-metabase-query/query.py sql "SELECT ... " [--project wms] [--database 6] [--format table|json|csv] [--out FILE]
```

- Always pass `--project` once the Reliance product is known — the default
  (`wms`) is silently wrong for a JioMart 3P incident.
- `--format json` is usually best when you (Claude) need to parse the result;
  `--format table` is best when showing it to the user directly.
- If you don't know a table/column name, don't guess — grep the actual model
  in the relevant codebase first (search for `db_table`). Confirm with
  `query.py tables --database <id> --project <project>` if unsure a table
  exists in that DB.

## Read-only enforcement

The script refuses (exit code 5, no request sent) any query that:
- doesn't start with `SELECT` or `WITH`, or
- contains `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`GRANT`/`REVOKE`/`EXEC`/`CALL`/`MERGE`/`COPY`/`VACUUM`/`REINDEX` anywhere.

Do not try to route around this — if a task genuinely needs a write, that's
out of scope for this skill; tell the user instead of attempting it another way.

## Rate limiting

Client-side limiter: 10 requests/60s burst, 120/hour sustained, tracked in
`Dev Resolve's config/ folder metabase_ratelimit.json`. If you hit it, the
script exits with a clear wait-time message — don't loop/retry faster than that.

## Error handling

- **`AUTH_FAILED` (401, session expired, no auto-refresh creds)** → tell the
  user which project and prompt them to run `set-credentials --project
  <project>` (or `login --project <project>`) themselves — never paste a
  password into chat. Once they confirm it's done, **retry the exact same
  command** — don't report this as "no data found."
- **`VPN_REQUIRED` (connection error reaching a `.ril.com` host)** → the
  Cisco AnyConnect `ril` VPN (`tvpn.ril.com`) is almost certainly not
  connected. Tell the user to connect it, then **retry the exact same
  command** once they confirm — don't report this as "no data found" either.
- **404** → wrong database/table id for that project, or wrong `--project`
  entirely — run `query.py databases --project <project>` or `query.py tables
  --database <id> --project <project>` to find the right one, don't guess
  table names blindly.
- **Query error in response body** → the script surfaces Metabase's own error
  message; read it and fix the SQL (usually a wrong column/table name — go
  re-check the relevant model).
- **Timeout** → narrow the query (add a `WHERE`, shrink a date range) or pass
  `--timeout <seconds>`.
- **"Unknown --project"** → run `query.py projects` to see what's actually
  configured right now (reads live from `projects.json`) — don't guess a new
  project name; add it to `projects.json` first if it genuinely doesn't
  exist yet (see `Dev Resolve's README.md ("Adding an account")`).

## Security notes

- Never print or log the full session token — only masked (`...last4chars`),
  which the script already does via `whoami`/`login`/`set-session`/
  `set-credentials` output.
- Never ask for or echo the user's Metabase password back to them, for any
  project — if auto-refresh needs setting up, tell the user to run
  `query.py set-credentials --project <project>` themselves in their own
  terminal. Never type a password into a Bash/Edit tool call yourself either
  — even one the user pastes into chat; that materializes it onto disk in a
  way that's avoidable. Have the user run the storage command themselves instead.
- This talks to production databases (Reliance VF, QC, and JioMart 3P) —
  treat results as sensitive customer/operational data; summarize findings
  for the user rather than dumping full raw rows when they contain PII.
