DO $$ BEGIN
	CREATE TYPE "public"."media_processing_job_status" AS ENUM('pending', 'inspecting', 'encoding', 'publishing', 'ready', 'error');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."media_quality_status" AS ENUM('pending', 'passed', 'failed');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."media_rendition_status" AS ENUM('pending', 'ready', 'error');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "pipeline_version" text;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "encoder_version" text;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "workflow_run_id" text;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "quality_status" "media_quality_status" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "highest_verified_rendition" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"media_asset_id" text NOT NULL,
	"workflow_run_id" text,
	"pipeline_version" text NOT NULL,
	"encoder_version" text NOT NULL,
	"source_pathname" text NOT NULL,
	"output_prefix" text NOT NULL,
	"status" "media_processing_job_status" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"last_error" text,
	"source_metadata" jsonb,
	"metrics" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_processing_jobs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_renditions" (
	"id" text PRIMARY KEY NOT NULL,
	"media_asset_id" text NOT NULL,
	"processing_job_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"storage_provider" "media_storage_provider" DEFAULT 'vercel-blob' NOT NULL,
	"storage_key" text NOT NULL,
	"media_url" text NOT NULL,
	"content_type" text NOT NULL,
	"codec" text,
	"width" integer,
	"height" integer,
	"bitrate" integer,
	"duration_ms" integer,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" "media_rendition_status" DEFAULT 'pending' NOT NULL,
	"quality_status" "media_quality_status" DEFAULT 'pending' NOT NULL,
	"quality_details" jsonb,
	"encoder_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_renditions_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade,
	CONSTRAINT "media_renditions_processing_job_id_media_processing_jobs_id_fk" FOREIGN KEY ("processing_job_id") REFERENCES "public"."media_processing_jobs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_workflow_run_idx" ON "media_assets" USING btree ("workflow_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_processing_jobs_asset_pipeline_uidx" ON "media_processing_jobs" USING btree ("media_asset_id", "pipeline_version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_processing_jobs_workflow_run_uidx" ON "media_processing_jobs" USING btree ("workflow_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_processing_jobs_output_prefix_uidx" ON "media_processing_jobs" USING btree ("output_prefix");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_processing_jobs_status_idx" ON "media_processing_jobs" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_renditions_asset_label_encoder_uidx" ON "media_renditions" USING btree ("media_asset_id", "kind", "label", "encoder_version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_renditions_storage_key_uidx" ON "media_renditions" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_renditions_job_idx" ON "media_renditions" USING btree ("processing_job_id", "status");
