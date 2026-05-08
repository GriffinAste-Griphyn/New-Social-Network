ALTER TABLE "stories" ADD COLUMN "moderation_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "reviewed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_moderation_status_idx" ON "stories" USING btree ("moderation_status");
