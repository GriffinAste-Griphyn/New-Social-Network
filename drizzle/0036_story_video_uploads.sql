CREATE TYPE "story_video_upload_surface" AS ENUM ('web', 'mobile');
CREATE TYPE "story_video_upload_protocol" AS ENUM ('tus', 'form');
CREATE TYPE "story_video_upload_status" AS ENUM (
  'pending',
  'completing',
  'completed',
  'failed'
);

CREATE TABLE "story_video_uploads" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id"),
  "uid" text NOT NULL,
  "surface" "story_video_upload_surface" NOT NULL,
  "upload_protocol" "story_video_upload_protocol" NOT NULL,
  "max_size_bytes" integer NOT NULL,
  "max_duration_seconds" integer NOT NULL,
  "status" "story_video_upload_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "story_id" text REFERENCES "stories"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "story_video_uploads_uid_idx"
  ON "story_video_uploads" ("uid");

CREATE INDEX "story_video_uploads_owner_status_idx"
  ON "story_video_uploads" ("owner_user_id", "status", "expires_at");

CREATE INDEX "story_video_uploads_story_idx"
  ON "story_video_uploads" ("story_id");
