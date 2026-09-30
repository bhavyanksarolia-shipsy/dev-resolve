-- Sign in with Google: users are matched by their verified Google email. Google-only users have no password.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));
