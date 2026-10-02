-- Private files kept in Postgres (survives every deploy, backed up with the DB). The backend writes them back to disk
-- on start (the Python tools read files) and saves every change here. Paths are relative to the backend root.
CREATE TABLE IF NOT EXISTS private_files (
  path       TEXT PRIMARY KEY,                 -- e.g. config/projects.json, knowledge/<acc>/playbook.md, .auth/users/<u>/…
  content    BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
