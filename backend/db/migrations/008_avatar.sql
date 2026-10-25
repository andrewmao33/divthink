-- A profile picture chosen in Settings → Account, as a small data URL
-- (the browser shrinks it to 128px first). Empty = Google's picture, or initials.
-- Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/008_avatar.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
