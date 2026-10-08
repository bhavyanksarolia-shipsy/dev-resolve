-- Notify the person who asked when a chat reply is ready (or failed), like investigations do.
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS chat_by TEXT;
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS chat_finished_at TIMESTAMPTZ;
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS chat_error TEXT;
CREATE INDEX IF NOT EXISTS investigations_finished_idx ON investigations (finished_at);
CREATE INDEX IF NOT EXISTS investigations_chat_finished_idx ON investigations (chat_finished_at);
