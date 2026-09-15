CREATE TABLE "media_background_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"media_asset_id" text,
	"story_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"owner_token" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_background_jobs" ADD CONSTRAINT "media_background_jobs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_background_jobs" ADD CONSTRAINT "media_background_jobs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "media_background_jobs_due_idx" ON "media_background_jobs" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "follows_fanout_cursor_idx" ON "follows" USING btree ("followee_id","follower_id");
