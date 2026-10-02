-- Files a reviewer attaches in the RCA chat (screenshots, PDFs, sheets…). Kept so the chat history can show them again.
CREATE TABLE IF NOT EXISTS chat_files (
  id               BIGSERIAL PRIMARY KEY,
  investigation_id BIGINT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  size             INTEGER NOT NULL,
  data             BYTEA NOT NULL,
  uploaded_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_files_investigation ON chat_files (investigation_id);
