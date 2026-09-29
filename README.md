# Dev Resolve

Evidence-based RCAs for DevRev tickets. For a ticket it searches the right account's **logs** (OpenSearch),
**database** (Metabase, read-only), and **code**, checks the **current state of the data**, drafts an RCA, and, after
a human reviews it, posts it to the ticket's **internal** discussion. Each approved RCA feeds the account's
knowledge base, so the next similar ticket is faster.

Self-contained: the OpenSearch MCP server, Metabase skill, ffo-miss-analysis skill, ticket digest service,
config and knowledge base all live in this folder.

## Run

```bash
# once
npm install
npm run setup            # starts Postgres (Docker, port 5434) + applies db/migrations
# every time
npm run dev              # http://localhost:3000 (or the next free port)
```

Requirements: Node 20+, Docker, Python 3 + `uv`, the client VPN for VPN-only hosts (`VPN_HINT` in config.env), and either a local Claude Code
login or `ANTHROPIC_API_KEY` in `.env.local` (set this before go-live).

## Layout

| Path | What |
|---|---|
| `config/projects.json` (private — start from `projects.example.json`) | **Single source of truth**: `accounts[]` (what tickets route to), connection projects (OpenSearch clusters / Metabase instances / log MCP), `devrev_routing` (ambiguous / ignored DevRev accounts) |
| `config/config.env` | Secrets for logs/DB (URLs, users, passwords, Metabase session tokens). gitignored, chmod 600 |
| `.env.local` | `DEVREV_TOKEN`, `DATABASE_URL`, optional `ANTHROPIC_API_KEY`, `CODE_ROOT`, `DEV_RESOLVE_MODEL` |
| `mcp/opensearch-logs/server.py` | Read-only OpenSearch MCP server (also registered in `.mcp.json` for Claude Code in this folder) |
| `.claude/skills/metabase-sql/` | Read-only Metabase CLI (`query.py`) — refuses anything but SELECT/WITH |
| `.claude/skills/ffo-miss-analysis/` | QC FFO miss RCA method + scripts |
| `services/wms_ticket_digest/` | The DevRev → Slack/Sheets ticket digest (Python, cron) |
| `knowledge/` (private except README + `_template/` + `_shared/`) | Layer-1 knowledge base (per-account playbooks) — see `knowledge/README.md` |
| `db/migrations/` | Postgres schema (investigations, steps, cases, knowledge_proposals) |
| `src/lib/agent/` | The investigation agent (Claude Agent SDK) and its tools |

## How an investigation works

1. The ticket's DevRev account is mapped to a Dev Resolve account via `config/projects.json`
   (a DevRev account shared by several tenants goes to a candidate list; the agent identifies the tenant).
2. The agent gets **only** these tools, scoped to that account: `search_logs` (only that account's
   log types), `metabase_query`/`metabase_tables` (only that account's databases), `code_search`/`code_read`,
   `similar_cases`, `propose_knowledge`, `submit_rca`. No shell, no file writes, no other tenants.
3. Its system prompt includes `knowledge/_shared` + `knowledge/<account>` + the account's skills.
4. It must finish with a **Current status** check: re-query the affected records now (still broken /
   fixed manually by whom & when / recovered automatically / partially fixed).
5. Every step is saved to Postgres and streamed to the ticket workspace.
6. You edit the draft, rate it, click **Approve & post**. It's posted with `visibility: internal`, saved as
   a resolved case, and if you changed the draft, your edit becomes a playbook proposal.

## Connection checks

The banner on each page runs one check per connection **defined in config**: DevRev, Postgres, Claude, and every
OpenSearch cluster / Metabase instance in `projects.json`. It names the exact one that failed and how to fix it:

| Status | Meaning | Fix shown |
|---|---|---|
| Connect VPN | a VPN-only host (`VPN_HOST_SUFFIXES`) is unreachable | connect the VPN named in `VPN_HINT` |
| Fix credentials | 401/403, missing user/pass, expired Metabase session | which `config.env` key, or the `query.py set-credentials --project X` command |
| Not configured | URL env var not set | which key to add |

During a run, any `VPN_REQUIRED` / `AUTH_FAILED` / `NOT_CONFIGURED` tool result is recorded as a connection error
naming the connection (e.g. `metabase:wms (db 2)`), and the agent is told the search did not happen.

## Adding an account (no code change)

All WMS accounts from DevRev are already listed in `config/projects.json` with `"status": "awaiting_credentials"`.
To connect one:

1. **Connection project**: add a top-level entry (see `config/projects.example.json`) with `opensearch.url_env`,
   `username_env`, `password_env`, `log_types` and/or `metabase.base_url_env`, `username_env`, `password_env`,
   `session_token_env`, `databases`.
2. **Secrets**: put those env-var values in `config/config.env`.
3. **Account**: in its `accounts[]` entry set `opensearch_log_type`, `opensearch_log_types` (`app`/`audit`/`integration`),
   `metabase_project`, `metabase_database`, `metabase_databases`, `code_repos`, and `"status": "active"`.
4. Re-check on the home page. The knowledge folder is created automatically from `knowledge/_template/`
   the first time a proposal is accepted for that account.

To change which DevRev accounts map to an account (ownership changes, renamed orgs), edit its `devrev.account_ids`.
