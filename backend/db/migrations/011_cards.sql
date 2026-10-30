-- One node per card: a node now holds the prompt and its response, instead of
-- a prompt node and a reply node joined by an edge. Edges go card -> card.
--
-- WIPES EVERY CANVAS (sessions, nodes, edges, attachments, repos). Users, keys
-- and usage history stay. The landing page demo keeps its canvas row, so its id
-- (VITE_DEMO_SESSION_ID) still works, but loses its cards. Rebuild them after:
--   .venv/bin/python -m scripts.make_demo
-- Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/011_cards.sql
-- Already included in schema.sql for a fresh one.

BEGIN;

DELETE FROM sessions WHERE NOT is_public;  -- cascades to nodes, edges, attachments, repos
DELETE FROM nodes;  -- the demo's too

ALTER TABLE nodes DROP COLUMN type;
ALTER TABLE nodes RENAME COLUMN content TO prompt;
ALTER TABLE nodes ADD COLUMN response text NOT NULL DEFAULT '';

COMMIT;
