CREATE TABLE IF NOT EXISTS "mobile_feed_snapshots" (
  "viewer_id" text PRIMARY KEY REFERENCES "users"("id"),
  "payload" jsonb NOT NULL,
  "source_fingerprint" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "mobile_feed_snapshots_expires_idx"
  ON "mobile_feed_snapshots" ("expires_at");

CREATE INDEX IF NOT EXISTS "mobile_feed_snapshots_updated_idx"
  ON "mobile_feed_snapshots" ("updated_at");
