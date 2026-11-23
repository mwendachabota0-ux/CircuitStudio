CREATE TABLE IF NOT EXISTS "circuit_studio_v2_drafts" (
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "representation" text NOT NULL,
  "schema_version" integer NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "draft" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "circuit_studio_v2_drafts_user_session_pk"
    PRIMARY KEY ("user_id", "session_id")
);

-- Upgrade rows created before optimistic concurrency was added. Existing rows
-- receive revision 1; reapplying this statement is safe.
ALTER TABLE IF EXISTS "circuit_studio_v2_drafts"
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
