ALTER TABLE investigations ADD COLUMN IF NOT EXISTS case_draft JSONB;  -- structured fields from submit_rca, copied into cases on approval
