-- When the account picked a plan on the page shown once after signing up
-- (frontend Plans.tsx). Empty until then. Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/007_plan_chosen.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_chosen_at timestamptz;

-- Accounts from before the page existed have been using the app already: they
-- don't need asking.
UPDATE users SET plan_chosen_at = created_at WHERE plan_chosen_at IS NULL;
