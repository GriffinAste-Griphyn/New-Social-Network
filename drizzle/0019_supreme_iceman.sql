ALTER TABLE "stories" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "processing_status" text DEFAULT 'ready' NOT NULL;