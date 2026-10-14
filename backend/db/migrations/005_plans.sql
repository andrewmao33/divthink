-- Which plan each account is on (app/plans.py). Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/005_plans.sql
--
-- To change someone's plan by hand:
--   UPDATE users SET plan = 'pro_max' WHERE email = 'someone@example.com';

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'pro', 'pro_max'));
