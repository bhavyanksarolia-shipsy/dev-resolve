-- Stage / Pod changes made from Dev Resolve (who changed what on which ticket, and whether DevRev accepted it).
CREATE TABLE IF NOT EXISTS ticket_updates (
  id          BIGSERIAL PRIMARY KEY,
  ticket      TEXT NOT NULL,
  changed_by  TEXT,
  change      JSONB NOT NULL,
  ok          BOOLEAN NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_updates_ticket ON ticket_updates (ticket, created_at DESC);
