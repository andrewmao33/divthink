-- A canvas anyone can read without signing in. Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/003_public_sessions.sql
--
-- To publish one:  UPDATE sessions SET is_public = true WHERE id = '<session id>';
-- To unpublish:    UPDATE sessions SET is_public = false WHERE id = '<session id>';

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
