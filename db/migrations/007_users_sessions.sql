-- Real app accounts (hashed passwords) and server-side sessions (revocable).
CREATE TABLE IF NOT EXISTS app_users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,               -- lower-case login name
  password_hash       TEXT NOT NULL,                      -- scrypt$N$r$p$salt$hash
  is_admin            BOOLEAN NOT NULL DEFAULT false,
  disabled_at         TIMESTAMPTZ,
  failed_logins       INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash   TEXT PRIMARY KEY,                          -- sha256 of the cookie value; the raw token is never stored
  user_id      INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id);
