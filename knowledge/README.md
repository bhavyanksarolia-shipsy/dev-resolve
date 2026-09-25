# Knowledge base

Two layers. The agent reads both before every investigation.

| Layer | Where | Written by | Content |
|---|---|---|---|
| 1. Playbooks | `knowledge/<account-slug>/*.md`, `queries/*.sql` (git) | Humans, or agent proposals a human **accepted** in the UI | How to investigate this account: which logs/tables first, what log lines mean, proven SQL |
| 2. Cases | Postgres `cases` table | Automatically, when an RCA is approved & posted | Every resolved ticket: symptoms → root cause → evidence that proved it |

Rules:
- The agent never edits these files directly. It files a *proposal*; a human accepts/edits/rejects it
  in the ticket workspace. Accepted proposals are appended here (and can be committed with git).
- Anything not verified against logs/DB/code is written as **Unverified:** so it's never taken as fact.
- `_shared/` holds WMS-wide facts that apply to every account. Account folders only hold what's
  specific to that tenant (warehouse codes, integrations, custom flows, table quirks).
- New accounts: the folder is created from `_template/` the first time a proposal is accepted for it.

Files per account:
- `playbook.md` — issue category → first checks (log types, queries, code paths) → known root causes
- `schema.md` — tables/collections that matter, valid statuses/transitions
- `log-patterns.md` — log message → what it means → where in code it's raised
- `glossary.md` — identifiers & terms (which system each ID belongs to, formats)
- `queries/*.sql` — proven read-only queries with a header comment saying when to use them
