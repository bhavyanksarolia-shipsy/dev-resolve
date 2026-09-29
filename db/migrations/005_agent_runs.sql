-- One row per agent run (the investigation itself, then each chat follow-up) with token usage from the SDK.
CREATE TABLE IF NOT EXISTS agent_runs (
  id                 BIGSERIAL PRIMARY KEY,
  investigation_id   BIGINT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,            -- investigation | chat
  started_by         TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  num_turns          INT,
  cost_usd           NUMERIC(10,4),
  input_tokens       BIGINT NOT NULL DEFAULT 0,  -- uncached input
  output_tokens      BIGINT NOT NULL DEFAULT 0,  -- includes thinking
  cache_read_tokens  BIGINT NOT NULL DEFAULT 0,
  cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  model_usage        JSONB                       -- per-model breakdown as reported by the SDK
);
CREATE INDEX IF NOT EXISTS agent_runs_inv_idx ON agent_runs (investigation_id, id);
