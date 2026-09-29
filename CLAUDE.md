@AGENTS.md

# Dev Resolve

- Config: `config/projects.json` (accounts + connections, dynamic — never hardcode account lists), secrets in
  `config/config.env` and `.env.local` (never print or commit them).
- Logs/DB tools in this folder are read-only by design; keep them that way.
- RCAs are posted to DevRev only via the human-approved `/api/investigations/[id]/post` route, always `visibility: internal`.
- Knowledge base: see `knowledge/README.md`. Agent proposes, human accepts.
