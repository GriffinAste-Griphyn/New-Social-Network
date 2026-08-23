CREATE TABLE IF NOT EXISTS "story_publish_jobs" (
	"story_id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"earnings_completed_at" timestamp with time zone,
	"fanout_completed_at" timestamp with time zone,
	"notification_claimed_at" timestamp with time zone,
	"notification_completed_at" timestamp with time zone,
	"snapshot_invalidated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_publish_jobs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO "story_publish_jobs" (
	"story_id", "workflow_run_id", "status", "attempts", "last_error",
	"earnings_completed_at", "fanout_completed_at", "notification_claimed_at",
	"notification_completed_at", "snapshot_invalidated_at", "completed_at",
	"created_at", "updated_at"
)
SELECT
	"story_id", "workflow_run_id", "status", "attempts", "last_error",
	"earnings_completed_at", "fanout_completed_at", "notification_claimed_at",
	"notification_completed_at", "snapshot_invalidated_at", "completed_at",
	"created_at", "updated_at"
FROM "story_publication_dispatches"
ON CONFLICT ("story_id") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_publish_jobs_status_idx" ON "story_publish_jobs" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "story_publish_jobs_run_idx" ON "story_publish_jobs" USING btree ("workflow_run_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "stories_live_feed_idx";
--> statement-breakpoint
CREATE INDEX "stories_live_feed_idx" ON "stories" USING btree ("status","moderation_status","expires_at","created_at" DESC) WHERE "status" = 'live' AND "moderation_status" = 'approved';
