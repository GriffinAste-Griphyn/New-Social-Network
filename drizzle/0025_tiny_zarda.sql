CREATE TYPE "public"."moderation_action" AS ENUM('approve', 'hold', 'reject');--> statement-breakpoint
CREATE TYPE "public"."moderation_check_target_kind" AS ENUM('story', 'interaction', 'avatar', 'user_profile');--> statement-breakpoint
CREATE TABLE "moderation_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"target_kind" "moderation_check_target_kind" NOT NULL,
	"target_id" text NOT NULL,
	"actor_user_id" text,
	"media_asset_id" text,
	"provider" text NOT NULL,
	"action" "moderation_action" NOT NULL,
	"reason" text,
	"categories" text DEFAULT '[]' NOT NULL,
	"raw_result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_interactions" ADD COLUMN "moderation_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD COLUMN "moderation_reason" text;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD COLUMN "reviewed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "moderation_checks" ADD CONSTRAINT "moderation_checks_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_checks" ADD CONSTRAINT "moderation_checks_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_checks_target_idx" ON "moderation_checks" USING btree ("target_kind","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_checks_action_idx" ON "moderation_checks" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "moderation_checks_actor_idx" ON "moderation_checks" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_checks_media_asset_idx" ON "moderation_checks" USING btree ("media_asset_id","created_at");--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_interactions_moderation_idx" ON "story_interactions" USING btree ("moderation_status","created_at");