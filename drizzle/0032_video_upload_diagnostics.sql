ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'video_upload_failed';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'video_upload_phase';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'video_upload_retry';--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name" ADD VALUE IF NOT EXISTS 'video_upload_succeeded';
