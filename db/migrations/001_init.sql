-- Investigations: one agent run per ticket attempt
CREATE TABLE IF NOT EXISTS investigations (
  id              BIGSERIAL PRIMARY KEY,
  ticket_id       TEXT NOT NULL,            -- DevRev DON
  ticket_display  TEXT NOT NULL,            -- TKT-123
  ticket_title    TEXT,
  account_slug    TEXT NOT NULL,            -- from config/projects.json accounts[].slug
  status          TEXT NOT NULL DEFAULT 'queued', -- queued|running|draft_ready|failed|posted
  error           TEXT,
  draft_rca       TEXT,                     -- agent output (markdown)
  final_rca       TEXT,                     -- what the human approved
  confidence      TEXT,                     -- high|medium|low
  category        TEXT,                     -- e.g. pgi_failure, grn_stuck
  cost_usd        NUMERIC(10,4),
  num_turns       INT,
  posted_comment_id TEXT,
  posted_at       TIMESTAMPTZ,
  rating          SMALLINT,                 -- 1..5 human rating of the draft
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS investigations_ticket_idx ON investigations (ticket_display);

-- Every tool call / message the agent made (the evidence trail shown live in the UI)
CREATE TABLE IF NOT EXISTS investigation_steps (
  id               BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  seq              INT NOT NULL,
  kind             TEXT NOT NULL,           -- thinking|text|tool_call|tool_result|connection_error|system
  tool             TEXT,
  input            JSONB,
  output           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steps_inv_idx ON investigation_steps (investigation_id, seq);

-- Layer 2 of the knowledge base: resolved cases, searchable for "similar past tickets"
CREATE TABLE IF NOT EXISTS cases (
  id               BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT REFERENCES investigations(id) ON DELETE SET NULL,
  account_slug     TEXT NOT NULL,
  ticket_display   TEXT NOT NULL,
  title            TEXT,
  category         TEXT,
  symptoms         TEXT,
  root_cause       TEXT,
  resolution       TEXT,
  evidence         JSONB,                   -- queries / log searches that proved it
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  search           TSVECTOR GENERATED ALWAYS AS (
                     setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                     setweight(to_tsvector('english', coalesce(symptoms,'')), 'A') ||
                     setweight(to_tsvector('english', coalesce(category,'')), 'B') ||
                     setweight(to_tsvector('english', coalesce(root_cause,'')), 'B') ||
                     setweight(to_tsvector('english', coalesce(resolution,'')), 'C')) STORED
);
CREATE INDEX IF NOT EXISTS cases_search_idx ON cases USING GIN (search);
CREATE INDEX IF NOT EXISTS cases_account_idx ON cases (account_slug);

-- Layer 1 learning loop: agent-proposed playbook edits awaiting human review
CREATE TABLE IF NOT EXISTS knowledge_proposals (
  id               BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT REFERENCES investigations(id) ON DELETE SET NULL,
  account_slug     TEXT NOT NULL,           -- or '_shared'
  file             TEXT NOT NULL,           -- playbook.md | schema.md | log-patterns.md | glossary.md | queries/<name>.sql
  content          TEXT NOT NULL,           -- markdown/SQL to append
  rationale        TEXT,
  source           TEXT NOT NULL DEFAULT 'agent', -- agent|human_edit
  status           TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
