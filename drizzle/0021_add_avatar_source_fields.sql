ALTER TABLE "users" ADD COLUMN "avatar_source_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_source_storage_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_source_content_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_source_byte_size" integer;