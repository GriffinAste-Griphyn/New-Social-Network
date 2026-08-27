CREATE TABLE IF NOT EXISTS "image_processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"media_asset_id" text NOT NULL,
	"workflow_run_id" text,
	"source_pathname" text NOT NULL,
	"base_pathname" text NOT NULL,
	"content_mode" text DEFAULT 'fit' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_processing_jobs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_processing_jobs_asset_uidx" ON "image_processing_jobs" USING btree ("media_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_processing_jobs_run_uidx" ON "image_processing_jobs" USING btree ("workflow_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_processing_jobs_status_idx" ON "image_processing_jobs" USING btree ("status", "updated_at");
