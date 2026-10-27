-- divthink schema. Matches the "Data model" section of design.md.
-- Apply to an empty database:  psql divthink -f backend/db/schema.sql

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  google_sub  text UNIQUE,
  auto_branch boolean NOT NULL DEFAULT true,
  plan        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'pro_max')),
  stripe_customer_id text UNIQUE,  -- set when they first go to checkout
  plan_chosen_at timestamptz,  -- picked a plan after signing up (Plans.tsx); empty until then
  avatar      text,  -- profile picture as a small data URL (Settings → Account); empty = default
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('anthropic', 'google', 'openai')),
  encrypted_key bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT '',
  default_model text,
  -- Readable by anyone, through /public/sessions/{id}: the demo canvas on the
  -- landing page. Off unless set by hand.
  is_public     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()  -- set by the app on change
);

-- Session list: a user's sessions, most recently updated first.
CREATE INDEX sessions_user_updated_idx ON sessions (user_id, updated_at DESC);

CREATE TABLE nodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('user', 'assistant', 'highlight')),
  content    text NOT NULL DEFAULT '',
  model      text,  -- assistant nodes only
  position_x double precision NOT NULL DEFAULT 0,
  position_y double precision NOT NULL DEFAULT 0,
  status     text NOT NULL CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Lets edges reference (session_id, id), so an edge can never connect nodes
  -- from two different sessions. Also serves as the index for loading a session.
  UNIQUE (session_id, id)
);

CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  parent_id  uuid NOT NULL,
  child_id   uuid NOT NULL,

  UNIQUE (parent_id, child_id),
  CHECK (parent_id <> child_id),

  -- Both ends must be nodes in this edge's session. Deleting a node deletes
  -- its edges; removing orphaned descendants is done by the app.
  FOREIGN KEY (session_id, parent_id) REFERENCES nodes (session_id, id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, child_id)  REFERENCES nodes (session_id, id) ON DELETE CASCADE
);

-- Images attached to a prompt. Kept as bytes rather than in object storage:
-- they are small, and this way they are covered by the same backups and the
-- same cascade as the node they belong to.
CREATE TABLE attachments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  node_id    uuid NOT NULL,
  media_type text NOT NULL CHECK (media_type IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'
  )),
  filename   text,  -- shown on the box; PDFs have no thumbnail to show instead
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (session_id, node_id) REFERENCES nodes (session_id, id) ON DELETE CASCADE
);

CREATE INDEX attachments_node_id_idx ON attachments (node_id);

-- A GitHub repo connected to a canvas (app/repos.py): one per canvas, its
-- text files kept here so replies can read and search them.
CREATE TABLE repos (
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

CREATE TABLE repo_files (
  session_id uuid NOT NULL REFERENCES repos (session_id) ON DELETE CASCADE,
  path       text NOT NULL,
  content    text NOT NULL,
  PRIMARY KEY (session_id, path)
);

-- Ancestor walk: find a node's parents by child_id.
-- (Lookups by parent_id use the UNIQUE (parent_id, child_id) index.)
CREATE INDEX edges_child_id_idx ON edges (child_id);

-- What every model call cost, per user (app/usage.py). No foreign key to nodes:
-- deleting a card or canvas keeps its cost on record, so an allowance can't be
-- reset by deleting things.
CREATE TABLE usage_events (
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

CREATE INDEX usage_events_user_created_idx ON usage_events (user_id, created_at);

-- Supabase exposes tables in the public schema through its REST API using the
-- browser's publishable key. Row level security with no policies blocks that
-- access entirely. The backend connects as the tables' owner, which RLS doesn't
-- apply to, so it is the only way in.
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE repos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_files ENABLE ROW LEVEL SECURITY;
