-- Who did what in the Dev Resolve UI (shared test logins; DevRev posts still go out under the owner's token)
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS started_by TEXT;
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS posted_by TEXT;
ALTER TABLE knowledge_proposals ADD COLUMN IF NOT EXISTS decided_by TEXT;
