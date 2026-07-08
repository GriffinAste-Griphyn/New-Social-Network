ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "placeholder_url" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "placeholder_url" text;--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'hls_asset_download_failed';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'hls_asset_download_finished';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'hls_asset_download_start';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'hls_asset_package_hit';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'media_qoe_config';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'video_access_log';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'image_derivatives_prepared';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'image_derivative_upload_failed';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'background_upload_resume';
