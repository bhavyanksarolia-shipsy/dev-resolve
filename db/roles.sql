-- One-time setup on a production Postgres (run as the admin/master user, e.g. with psql).
-- Two roles: an OWNER that runs migrations (MIGRATION_DATABASE_URL) and an APP role with data access only
-- (DATABASE_URL). If the app is ever compromised it can read/write rows but can't drop or alter tables.
-- Replace the two passwords (psql: \password dev_resolve_owner) — never commit real ones.
--
--   psql "$ADMIN_URL" -v owner_pw="'…'" -v app_pw="'…'" -f db/roles.sql

CREATE ROLE dev_resolve_owner LOGIN PASSWORD :owner_pw;
CREATE ROLE dev_resolve_app   LOGIN PASSWORD :app_pw;
CREATE DATABASE dev_resolve OWNER dev_resolve_owner;
\connect dev_resolve
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO dev_resolve_owner;
GRANT USAGE ON SCHEMA public TO dev_resolve_app;
-- Tables/sequences the owner creates (now and in future migrations) are usable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE dev_resolve_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dev_resolve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dev_resolve_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dev_resolve_app;
ALTER ROLE dev_resolve_app SET statement_timeout = '30s';
ALTER ROLE dev_resolve_app SET idle_in_transaction_session_timeout = '60s';
