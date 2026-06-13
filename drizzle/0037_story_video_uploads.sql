CREATE TYPE "public"."story_video_upload_protocol" AS ENUM('tus', 'form');--> statement-breakpoint
CREATE TYPE "public"."story_video_upload_status" AS ENUM('pending', 'completing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."story_video_upload_surface" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TABLE "story_video_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
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
	"story_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_video_uploads" ADD CONSTRAINT "story_video_uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_video_uploads" ADD CONSTRAINT "story_video_uploads_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_video_uploads_uid_idx" ON "story_video_uploads" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "story_video_uploads_owner_status_idx" ON "story_video_uploads" USING btree ("owner_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "story_video_uploads_story_idx" ON "story_video_uploads" USING btree ("story_id");