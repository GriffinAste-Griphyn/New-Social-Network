CREATE TYPE "public"."media_asset_purpose" AS ENUM('story', 'story_reply', 'avatar');--> statement-breakpoint
CREATE TYPE "public"."media_asset_status" AS ENUM('processing', 'ready', 'flagged', 'rejected', 'deleted', 'error');--> statement-breakpoint
CREATE TYPE "public"."media_scan_status" AS ENUM('pending', 'passed', 'flagged', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."media_storage_provider" AS ENUM('local', 'vercel-blob', 'cloudflare-stream');--> statement-breakpoint
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
	"scan_reason",
	"provider_status",
	"ready_at",
	"created_at",
	"updated_at"
)
SELECT
	'story-media-' || "id",
	"creator_id",
	'story',
	"asset_kind",
	CASE
		WHEN "storage_provider" = 'cloudflare-stream' THEN 'cloudflare-stream'::"media_storage_provider"
		WHEN "storage_provider" = 'vercel-blob' THEN 'vercel-blob'::"media_storage_provider"
		WHEN "storage_provider" = 'local' THEN 'local'::"media_storage_provider"
		WHEN "media_url" LIKE '/api/story-media/cloudflare-stream/%' THEN 'cloudflare-stream'::"media_storage_provider"
		WHEN "media_url" LIKE '%blob.vercel-storage.com%' THEN 'vercel-blob'::"media_storage_provider"
		ELSE 'local'::"media_storage_provider"
	END,
	COALESCE(NULLIF("storage_key", ''), 'legacy/story/' || "id"),
	"media_url",
	"thumbnail_url",
	COALESCE(NULLIF("content_type", ''), CASE WHEN "asset_kind" = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END),
	COALESCE("byte_size", 0),
	COALESCE(NULLIF("checksum", ''), md5("media_url")),
	"width",
	"height",
	"duration_ms",
	CASE
		WHEN "status" = 'removed' THEN 'deleted'::"media_asset_status"
		WHEN "processing_status" = 'processing' THEN 'processing'::"media_asset_status"
		ELSE 'ready'::"media_asset_status"
	END,
	'skipped'::"media_scan_status",
	'Backfilled from pre-media-assets story row.',
	"processing_status",
	CASE WHEN "processing_status" = 'processing' THEN NULL ELSE "created_at" END,
	"created_at",
	now()
FROM "stories";--> statement-breakpoint
UPDATE "stories" SET "media_asset_id" = 'story-media-' || "id";--> statement-breakpoint
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
	"processing_status",
	"scan_status",
	"scan_reason",
	"ready_at",
	"created_at",
	"updated_at"
)
SELECT
	'story-reply-media-' || "id",
	"actor_id",
	'story_reply',
	COALESCE("media_asset_kind", 'image'::"story_asset_kind"),
	CASE
		WHEN "media_url" LIKE '/api/story-media/cloudflare-stream/%' THEN 'cloudflare-stream'::"media_storage_provider"
		WHEN "media_url" LIKE '%blob.vercel-storage.com%' THEN 'vercel-blob'::"media_storage_provider"
		ELSE 'local'::"media_storage_provider"
	END,
	'legacy/story-reply/' || "id",
	"media_url",
	"media_thumbnail_url",
	CASE WHEN COALESCE("media_asset_kind", 'image'::"story_asset_kind") = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END,
	0,
	md5("media_url"),
	'ready'::"media_asset_status",
	'skipped'::"media_scan_status",
	'Backfilled from pre-media-assets story interaction row.',
	"created_at",
	"created_at",
	now()
FROM "story_interactions"
WHERE "media_url" IS NOT NULL;--> statement-breakpoint
UPDATE "story_interactions"
SET "media_asset_id" = 'story-reply-media-' || "id"
WHERE "media_url" IS NOT NULL;--> statement-breakpoint
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
	"processing_status",
	"scan_status",
	"scan_reason",
	"ready_at",
	"created_at",
	"updated_at"
)
SELECT
	'avatar-media-' || "id",
	"id",
	'avatar',
	'image',
	CASE
		WHEN "avatar_url" LIKE '%blob.vercel-storage.com%' THEN 'vercel-blob'::"media_storage_provider"
		ELSE 'local'::"media_storage_provider"
	END,
	'legacy/avatar/' || "id",
	"avatar_url",
	"avatar_url",
	CASE
		WHEN lower("avatar_url") LIKE '%.png%' THEN 'image/png'
		WHEN lower("avatar_url") LIKE '%.webp%' THEN 'image/webp'
		WHEN lower("avatar_url") LIKE '%.heic%' THEN 'image/heic'
		ELSE 'image/jpeg'
	END,
	0,
	md5("avatar_url"),
	'ready'::"media_asset_status",
	'skipped'::"media_scan_status",
	'Backfilled from pre-media-assets avatar URL.',
	"created_at",
	"created_at",
	now()
FROM "users"
WHERE "avatar_url" IS NOT NULL;--> statement-breakpoint
UPDATE "users"
SET "avatar_asset_id" = 'avatar-media-' || "id"
WHERE "avatar_url" IS NOT NULL;--> statement-breakpoint
INSERT INTO "media_audit_events" ("id", "media_asset_id", "actor_user_id", "event_type", "message", "created_at")
SELECT 'media-audit-backfill-' || "id", "id", "owner_user_id", 'backfilled', "scan_reason", now()
FROM "media_assets";--> statement-breakpoint
ALTER TABLE "stories" ALTER COLUMN "media_asset_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "media_assets_provider_key_idx" ON "media_assets" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_processing_idx" ON "media_assets" USING btree ("processing_status","updated_at");--> statement-breakpoint
CREATE INDEX "media_assets_scan_idx" ON "media_assets" USING btree ("scan_status","updated_at");--> statement-breakpoint
CREATE INDEX "media_audit_events_asset_idx" ON "media_audit_events" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "media_audit_events_type_idx" ON "media_audit_events" USING btree ("event_type","created_at");--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stories_media_asset_idx" ON "stories" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "story_interactions_media_asset_idx" ON "story_interactions" USING btree ("media_asset_id");
