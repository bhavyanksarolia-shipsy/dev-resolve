-- Each person's Pod scope (header picker). Empty = all Pods. Tickets with no Pod are always shown to everyone.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pods TEXT[] NOT NULL DEFAULT '{}';
