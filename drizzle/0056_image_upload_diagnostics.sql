ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'image_upload_failed';
--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'image_upload_phase';
--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'image_upload_succeeded';
--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'metric_kit_diagnostic';
--> statement-breakpoint
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'metric_kit_payload';
--> statement-breakpoint
ALTER TABLE "public"."image_processing_jobs"
  ALTER COLUMN "content_mode" SET DEFAULT 'fill';
