---
name: metabase-sql
description: Run read-only SQL against the Metabase instances configured in config/projects.json (selected with --project / --database) — for live DB checks while investigating a ticket, instead of asking someone to paste query results.
---

# Metabase SQL (read-only)

`query.py` in this folder talks to the Metabase HTTP API. Which Metabase instances exist, their databases and
credentials all come from Dev Resolve's private config — `config/projects.json` (connection projects with a
`metabase` section) and `config/config.env` (URLs, users, passwords, session tokens). Nothing is hardcoded here.

**Read-only by design:** only `SELECT` / `WITH` queries are accepted; anything with a write/DDL keyword is refused.

```sh
python3 .claude/skills/metabase-sql/query.py projects                          # configured projects + login state
python3 .claude/skills/metabase-sql/query.py databases --project <project>     # database ids for a project
python3 .claude/skills/metabase-sql/query.py tables    --project <project> --database <id>
python3 .claude/skills/metabase-sql/query.py sql "SELECT … LIMIT 50" --project <project> --database <id> [--format json|csv]
```

Logins:
- Username/password: `npm run metabase-password -- <project>` (hidden input; the tool re-logs in on its own).
- Google login (`"sso": "google"` on the project): `npm run metabase-login -- <project>` once; sessions are renewed
  silently afterwards.

Rules:
- Always pass `--project` (database ids collide across projects) and add a `LIMIT` and a time filter.
- Shared databases hold several clients — restrict every query to the ticket's account (its warehouses/users).
- Errors are tagged: `VPN_REQUIRED` (host needs the VPN from `VPN_HINT`), `AUTH_FAILED` (credentials/session) —
  neither means "no data"; fix the connection and retry the same query.
- A rate limit (10 requests / minute, 120 / hour) protects the production databases.
