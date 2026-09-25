# QC (Quick Commerce / JioMart darkstore) — playbook

## Connections
- Logs: `qc_app`, `qc_audit`, `qc_api` (same OpenSearch host as VF, different indices)
- DB: Metabase `--project qc --database 6` (Postgres slave), `--database 7` (Mongo)

## Issue category: FFO misses / cut order lines / short picks
Use the **`ffo-miss-analysis` skill** (bundled in `.claude/skills/`) — it holds the full proven method:
day-level RCA (exclusions, two-bucket model, waterfall), single-order diagnosis (pick task created? which
inventory callback preceded the order?), and evidence-based classification of allocation misses.
