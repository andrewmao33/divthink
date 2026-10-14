-- What every model call cost, per user. Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/004_usage.sql
--
-- No foreign key to nodes: deleting a card or canvas keeps its cost on record,
-- so a monthly allowance can't be reset by deleting things. Deleting the
-- account removes it (ON DELETE CASCADE from users).

CREATE TABLE IF NOT EXISTS usage_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  node_id            uuid,
  model              text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('reply', 'title')),
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  searches           integer NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events (user_id, created_at);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
