-- Images attached to a prompt. Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/001_attachments.sql
-- Already included in schema.sql for a fresh one.

CREATE TABLE IF NOT EXISTS attachments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  node_id    uuid NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Tied to the node it was sent with, in the same session; deleting the node
  -- takes its images with it.
  FOREIGN KEY (session_id, node_id) REFERENCES nodes (session_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachments_node_id_idx ON attachments (node_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
