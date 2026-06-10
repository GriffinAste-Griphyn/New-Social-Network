ALTER TABLE "media_assets" ADD COLUMN "original_media_url" text;
ALTER TABLE "media_assets" ADD COLUMN "original_thumbnail_url" text;
ALTER TABLE "media_assets" ADD COLUMN "original_storage_provider" "media_storage_provider";
ALTER TABLE "media_assets" ADD COLUMN "original_storage_key" text;
ALTER TABLE "media_assets" ADD COLUMN "original_content_type" text;
ALTER TABLE "media_assets" ADD COLUMN "original_byte_size" integer;
ALTER TABLE "media_assets" ADD COLUMN "original_checksum" text;
ALTER TABLE "media_assets" ADD COLUMN "original_width" integer;
ALTER TABLE "media_assets" ADD COLUMN "original_height" integer;
ALTER TABLE "media_assets" ADD COLUMN "original_duration_ms" integer;

ALTER TABLE "stories" ADD COLUMN "original_media_url" text;
ALTER TABLE "stories" ADD COLUMN "original_thumbnail_url" text;
ALTER TABLE "stories" ADD COLUMN "original_storage_provider" text;
ALTER TABLE "stories" ADD COLUMN "original_storage_key" text;
ALTER TABLE "stories" ADD COLUMN "original_content_type" text;
ALTER TABLE "stories" ADD COLUMN "original_byte_size" integer;
ALTER TABLE "stories" ADD COLUMN "original_checksum" text;
ALTER TABLE "stories" ADD COLUMN "original_width" integer;
ALTER TABLE "stories" ADD COLUMN "original_height" integer;
ALTER TABLE "stories" ADD COLUMN "original_duration_ms" integer;

UPDATE "media_assets"
SET
  "original_media_url" = "media_url",
  "original_thumbnail_url" = "thumbnail_url",
  "original_storage_provider" = "storage_provider",
  "original_storage_key" = "storage_key",
  "original_content_type" = "content_type",
  "original_byte_size" = "byte_size",
  "original_checksum" = "checksum",
  "original_width" = "width",
  "original_height" = "height",
  "original_duration_ms" = "duration_ms"
WHERE "asset_kind" = 'video'
  AND "storage_provider" = 'vercel-blob'
  AND "original_media_url" IS NULL;

UPDATE "stories"
SET
  "original_media_url" = "media_url",
  "original_thumbnail_url" = "thumbnail_url",
  "original_storage_provider" = "storage_provider",
  "original_storage_key" = "storage_key",
  "original_content_type" = "content_type",
  "original_byte_size" = "byte_size",
  "original_checksum" = "checksum",
  "original_width" = "width",
  "original_height" = "height",
  "original_duration_ms" = "duration_ms"
WHERE "asset_kind" = 'video'
  AND "storage_provider" = 'vercel-blob'
  AND "original_media_url" IS NULL;

CREATE INDEX "media_assets_original_provider_key_idx"
  ON "media_assets" ("original_storage_provider", "original_storage_key");

CREATE INDEX "stories_original_storage_key_idx"
  ON "stories" ("original_storage_key");
