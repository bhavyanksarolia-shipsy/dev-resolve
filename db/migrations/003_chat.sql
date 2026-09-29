-- Chat on an RCA: resume the investigation's agent session; RCA drafts are versioned.
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS session_id TEXT;             -- Claude Agent SDK session to resume
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS candidate_slugs TEXT[];      -- ambiguous-ticket candidates, reused on resume
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS rca_version INT NOT NULL DEFAULT 0;    -- bumps on every submit_rca
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS posted_version INT NOT NULL DEFAULT 0; -- rca_version last posted to DevRev
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS chat_running BOOLEAN NOT NULL DEFAULT false;
UPDATE investigations SET rca_version = 1 WHERE draft_rca IS NOT NULL AND rca_version = 0;
UPDATE investigations SET posted_version = 1 WHERE posted_at IS NOT NULL AND posted_version = 0;
