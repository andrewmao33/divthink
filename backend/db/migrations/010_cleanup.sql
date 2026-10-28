-- Opening a canvas loads its edges by session_id, which had no index.
-- Also drops leftovers: google_sub (Supabase handles Google sign-in),
-- auto_branch (the feature was removed), and 'openai' as a key provider
-- (no OpenAI models; /keys only accepts anthropic and google).
-- Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/010_cleanup.sql
-- Already included in schema.sql for a fresh one.

BEGIN;

CREATE INDEX IF NOT EXISTS edges_session_id_idx ON edges (session_id);

ALTER TABLE users DROP COLUMN IF EXISTS google_sub;
ALTER TABLE users DROP COLUMN IF EXISTS auto_branch;

-- Fails if an 'openai' key was ever saved; delete those rows first.
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_provider_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_provider_check CHECK (provider IN ('anthropic', 'google'));

COMMIT;
