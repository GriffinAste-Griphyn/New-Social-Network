ALTER TABLE "stories" ADD COLUMN "storage_provider" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "checksum" text;