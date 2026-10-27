-- A GitHub repo connected to a canvas, so replies on it can read the code.
-- Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/009_repos.sql
-- Already included in schema.sql for a fresh one.

CREATE TABLE IF NOT EXISTS repos (
  session_id  uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  owner       text NOT NULL,
  name        text NOT NULL,
  ref         text NOT NULL,  -- the branch (or tag) it was downloaded from
  sha         text NOT NULL,  -- the commit, so a reply can say which version it read
  file_count  integer NOT NULL,
  total_bytes integer NOT NULL,
  truncated   boolean NOT NULL DEFAULT false,  -- some files left out to stay under the cap
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repo_files (
  session_id uuid NOT NULL REFERENCES repos (session_id) ON DELETE CASCADE,
  path       text NOT NULL,
  content    text NOT NULL,
  PRIMARY KEY (session_id, path)
);

ALTER TABLE repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_files ENABLE ROW LEVEL SECURITY;
