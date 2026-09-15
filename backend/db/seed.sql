-- Hardcoded dev user, used for every request until auth exists (build step 5).
-- Safe to run repeatedly.

INSERT INTO users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev@localhost')
ON CONFLICT (id) DO NOTHING;
