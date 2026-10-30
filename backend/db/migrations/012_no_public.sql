-- The public demo canvas (/public/sessions/{id}) is gone: the landing page
-- builds its demo in the browser (frontend/src/demo.ts). Deletes the old demo
-- canvas and the flag that made it readable without an account.
-- Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/012_no_public.sql
-- Already included in schema.sql for a fresh one.

BEGIN;

DELETE FROM sessions WHERE is_public;
ALTER TABLE sessions DROP COLUMN is_public;

COMMIT;
