ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "playback_renditions" jsonb;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "playback_renditions" jsonb;
