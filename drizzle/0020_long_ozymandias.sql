CREATE TYPE "public"."media_asset_purpose" AS ENUM('story', 'story_reply', 'avatar');--> statement-breakpoint
CREATE TYPE "public"."media_asset_status" AS ENUM('processing', 'ready', 'flagged', 'rejected', 'deleted', 'error');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('pending', 'passed', 'flagged', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."media_storage_provider" AS ENUM('local', 'vercel-blob', 'cloudflare-stream');--> statement-breakpoint
CREATE TYPE "public"."safety_report_reason" AS ENUM('spam', 'harassment', 'hate', 'sexual_content', 'violence', 'self_harm', 'illegal_goods', 'impersonation', 'intellectual_property', 'other');--> statement-breakpoint
CREATE TYPE "public"."safety_report_status" AS ENUM('pending', 'reviewed', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."safety_report_target_kind" AS ENUM('story', 'user', 'interaction');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"purpose" "media_asset_purpose" NOT NULL,
	"asset_kind" "story_asset_kind" NOT NULL,
	"storage_provider" "media_storage_provider" NOT NULL,
	"storage_key" text NOT NULL,
	"media_url" text NOT NULL,
	"thumbnail_url" text,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"processing_status" "media_asset_status" DEFAULT 'processing' NOT NULL,
	"scan_status" "media_scan_status" DEFAULT 'pending' NOT NULL,
	"scan_reason" text,
	"provider_status" text,
	"provider_error" text,
	"last_checked_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"media_asset_id" text NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"message" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_kind" "safety_report_target_kind" NOT NULL,
	"target_user_id" text,
	"target_story_id" text,
	"target_interaction_id" text,
	"reason" "safety_report_reason" NOT NULL,
	"details" text,
	"status" "safety_report_status" DEFAULT 'pending' NOT NULL,
	"resolution_note" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_pkey" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "media_asset_id" text;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD COLUMN "media_asset_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_asset_id" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "media_assets" (
	"id",
	"owner_user_id",
	"purpose",
	"asset_kind",
	"storage_provider",
	"storage_key",
	"media_url",
	"thumbnail_url",
	"content_type",
	"byte_size",
	"checksum",
	"width",
	"height",
	"duration_ms",
	"processing_status",
	"scan_status",
	"ready_at",
	"created_at",
	"updated_at"
)
SELECT
	'legacy-story-' || "stories"."id",
	"stories"."creator_id",
	'story',
	"stories"."asset_kind",
	CASE
		WHEN "stories"."storage_provider" IN ('local', 'vercel-blob', 'cloudflare-stream')
			THEN "stories"."storage_provider"::media_storage_provider
		WHEN "stories"."media_url" LIKE 'https://customer-%cloudflarestream.com/%'
			THEN 'cloudflare-stream'::media_storage_provider
		WHEN "stories"."media_url" LIKE 'https://%public.blob.vercel-storage.com/%'
			THEN 'vercel-blob'::media_storage_provider
		ELSE 'local'::media_storage_provider
	END,
	COALESCE("stories"."storage_key", 'legacy/story/' || "stories"."id"),
	"stories"."media_url",
	"stories"."thumbnail_url",
	COALESCE(
		"stories"."content_type",
		CASE
			WHEN "stories"."asset_kind" = 'video' THEN 'video/mp4'
			ELSE 'image/jpeg'
		END
	),
	COALESCE("stories"."byte_size", 0),
	COALESCE("stories"."checksum", 'legacy-' || "stories"."id"),
	"stories"."width",
	"stories"."height",
	"stories"."duration_ms",
	COALESCE("stories"."processing_status", 'ready')::media_asset_status,
	'passed',
	now(),
	"stories"."created_at",
	now()
FROM "stories"
WHERE "stories"."media_asset_id" IS NULL;--> statement-breakpoint
UPDATE "stories"
SET "media_asset_id" = 'legacy-story-' || "stories"."id"
WHERE "stories"."media_asset_id" IS NULL;--> statement-breakpoint
ALTER TABLE "stories" ALTER COLUMN "media_asset_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_target_story_id_stories_id_fk" FOREIGN KEY ("target_story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_target_interaction_id_story_interactions_id_fk" FOREIGN KEY ("target_interaction_id") REFERENCES "public"."story_interactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_provider_key_idx" ON "media_assets" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_processing_idx" ON "media_assets" USING btree ("processing_status","updated_at");--> statement-breakpoint
CREATE INDEX "media_assets_scan_idx" ON "media_assets" USING btree ("scan_status","updated_at");--> statement-breakpoint
CREATE INDEX "media_audit_events_asset_idx" ON "media_audit_events" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "media_audit_events_actor_idx" ON "media_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_status_idx" ON "safety_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_reporter_idx" ON "safety_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_target_user_idx" ON "safety_reports" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_target_story_idx" ON "safety_reports" USING btree ("target_story_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_target_interaction_idx" ON "safety_reports" USING btree ("target_interaction_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reports_story_once_idx" ON "safety_reports" USING btree ("target_kind","reporter_id","target_story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reports_user_once_idx" ON "safety_reports" USING btree ("target_kind","reporter_id","target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reports_interaction_once_idx" ON "safety_reports" USING btree ("target_kind","reporter_id","target_interaction_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocker_idx" ON "user_blocks" USING btree ("blocker_id","created_at");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id","created_at");--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
