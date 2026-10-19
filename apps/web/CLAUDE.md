@AGENTS.md

# Dev Resolve

- Config: `config/projects.json` (accounts + connections, dynamic — never hardcode account lists), secrets in
  `config/config.env` and `.env.local` (never print or commit them).
- Logs/DB tools in this folder are read-only by design; keep them that way.
- RCAs post to DevRev automatically on every new version (`lib/agent/rcaPost.ts`'s `postRca`, called from `submit_rca`), always `visibility: internal`, clearly labeled as not yet human-reviewed. A human can also review/edit and (re-)post via `/api/investigations/[id]/post`, which shares the same `postRca` function.
- Knowledge base: see `knowledge/README.md`. Agent proposes, human accepts.
