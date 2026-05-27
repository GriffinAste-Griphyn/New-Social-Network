DO $$ BEGIN
  CREATE TYPE "public"."mobile_performance_event_name" AS ENUM(
    'api_request',
    'api_server_timing',
    'feed_disk_cache_clear',
    'feed_disk_cache_hit',
    'feed_disk_cache_miss',
    'feed_disk_cache_restore',
    'feed_disk_cache_write',
    'feed_disk_restore',
    'feed_load',
    'feed_media_preheat',
    'feed_refresh_failed',
    'media_cache_summary',
    'media_file_cache_failed',
    'media_file_cache_hit',
    'media_file_cache_skip',
    'media_file_cache_write',
    'story_open',
    'story_open_warm',
    'story_stack_cache_clear',
    'story_stack_cache_hit',
    'story_stack_cache_miss',
    'story_stack_disk_cache_hit',
    'story_stack_disk_cache_miss',
    'story_stack_disk_cache_write',
    'story_stack_disk_restore',
    'story_stack_display_cache_hit',
    'story_stack_fetch_join',
    'story_stack_network',
    'story_stack_prefetch_end',
    'story_stack_prefetch_start',
    'video_disk_cache_hit',
    'video_first_frame',
    'video_item_ready',
    'video_stalled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_performance_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" "public"."mobile_performance_event_name" NOT NULL,
  "duration_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "client_created_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_performance_events"
  DROP CONSTRAINT IF EXISTS "mobile_performance_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mobile_performance_events"
  ADD CONSTRAINT "mobile_performance_events_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_performance_events_user_created_idx"
  ON "mobile_performance_events" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_performance_events_name_created_idx"
  ON "mobile_performance_events" USING btree ("name","created_at");
