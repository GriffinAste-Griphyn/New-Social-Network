CREATE TABLE "story_publication_dispatches" (
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
	CONSTRAINT "story_publication_dispatches_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "story_publication_dispatch_status_idx" ON "story_publication_dispatches" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "story_publication_dispatch_run_idx" ON "story_publication_dispatches" USING btree ("workflow_run_id");
--> statement-breakpoint
CREATE INDEX "stories_live_approved_created_idx" ON "stories" USING btree ("created_at" DESC,"expires_at") WHERE "status" = 'live' AND "moderation_status" = 'approved';
