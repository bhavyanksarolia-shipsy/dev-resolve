-- Local connectors: a small program each person runs on their own laptop. It carries client-VPN requests
-- and brings that person's Google sign-ins (Metabase, app logs) to the server. One token per person/laptop.
CREATE TABLE IF NOT EXISTS connector_tokens (
  token_hash   TEXT PRIMARY KEY,                 -- sha256; the raw token is shown once when created
  user_id      INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS connector_tokens_user_idx ON connector_tokens (user_id);
