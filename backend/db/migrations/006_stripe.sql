-- Links an account to its Stripe customer (routes/billing.py). Run against an
-- existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/006_stripe.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;
