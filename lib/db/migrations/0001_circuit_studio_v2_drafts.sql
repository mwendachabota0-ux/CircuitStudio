CREATE TABLE IF NOT EXISTS "circuit_studio_v2_drafts" (
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "representation" text NOT NULL,
  "schema_version" integer NOT NULL,
  "draft" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "circuit_studio_v2_drafts_user_session_pk"
    PRIMARY KEY ("user_id", "session_id")
);
