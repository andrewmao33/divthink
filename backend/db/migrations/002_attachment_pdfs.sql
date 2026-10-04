-- Allow PDFs alongside images. Run against an existing database:
--   psql "$DATABASE_URL" -f backend/db/migrations/002_attachment_pdfs.sql

ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_media_type_check;

ALTER TABLE attachments ADD CONSTRAINT attachments_media_type_check
  CHECK (media_type IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'
  ));

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS filename text;
