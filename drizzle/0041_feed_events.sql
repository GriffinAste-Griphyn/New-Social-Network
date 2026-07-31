ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'silent_push_prewarm';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."feed_event_kind" AS ENUM(
    'impression',
    'completion',
    'skip',
    'hide',
    'rewatch'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feed_events" (
  "id" text PRIMARY KEY NOT NULL,
  "viewer_id" text NOT NULL,
  "story_id" text NOT NULL,
  "creator_id" text NOT NULL,
  "kind" "feed_event_kind" NOT NULL,
  "viewed_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_viewer_id_users_id_fk"
    FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_story_id_stories_id_fk"
    FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_creator_id_users_id_fk"
    FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_events_viewer_created_idx"
  ON "feed_events" ("viewer_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_events_story_created_idx"
  ON "feed_events" ("story_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_events_creator_kind_created_idx"
  ON "feed_events" ("creator_id", "kind", "created_at");
