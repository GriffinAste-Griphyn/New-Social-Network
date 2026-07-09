CREATE TABLE IF NOT EXISTS "media_upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"purpose" "media_asset_purpose" DEFAULT 'story' NOT NULL,
	"asset_kind" "story_asset_kind" NOT NULL,
	"storage_provider" "media_storage_provider" NOT NULL,
	"storage_key" text NOT NULL,
	"client_upload_id" text,
	"upload_url" text NOT NULL,
	"upload_protocol" text NOT NULL,
	"expected_content_type" text,
	"expected_byte_size" integer,
	"max_duration_seconds" integer,
	"status" text DEFAULT 'prepared' NOT NULL,
	"provider_status" text,
	"provider_pct_complete" integer,
	"provider_error" text,
	"provider_payload" jsonb,
	"provider_event_at" timestamp with time zone,
	"completed_media_asset_id" text,
	"completed_story_id" text,
	"completion_claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_upload_sessions_status_check"
		CHECK ("status" IN ('prepared', 'completing', 'completed')),
	CONSTRAINT "media_upload_sessions_provider_pct_check"
		CHECK ("provider_pct_complete" IS NULL OR ("provider_pct_complete" >= 0 AND "provider_pct_complete" <= 100)),
	CONSTRAINT "media_upload_sessions_expected_byte_size_check"
		CHECK ("expected_byte_size" IS NULL OR "expected_byte_size" > 0),
	CONSTRAINT "media_upload_sessions_max_duration_check"
		CHECK ("max_duration_seconds" IS NULL OR "max_duration_seconds" > 0)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'media_upload_sessions_owner_user_id_users_id_fk'
	) THEN
		ALTER TABLE "media_upload_sessions"
			ADD CONSTRAINT "media_upload_sessions_owner_user_id_users_id_fk"
			FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
			ON DELETE NO ACTION ON UPDATE NO ACTION;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'media_upload_sessions_completed_media_asset_id_media_assets_id_fk'
	) THEN
		ALTER TABLE "media_upload_sessions"
			ADD CONSTRAINT "media_upload_sessions_completed_media_asset_id_media_assets_id_fk"
			FOREIGN KEY ("completed_media_asset_id") REFERENCES "public"."media_assets"("id")
			ON DELETE SET NULL ON UPDATE NO ACTION;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'media_upload_sessions_completed_story_id_stories_id_fk'
	) THEN
		ALTER TABLE "media_upload_sessions"
			ADD CONSTRAINT "media_upload_sessions_completed_story_id_stories_id_fk"
			FOREIGN KEY ("completed_story_id") REFERENCES "public"."stories"("id")
			ON DELETE SET NULL ON UPDATE NO ACTION;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_provider_key_uidx"
	ON "media_upload_sessions" USING btree ("storage_provider", "storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_completed_story_uidx"
	ON "media_upload_sessions" USING btree ("completed_story_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_completed_asset_uidx"
	ON "media_upload_sessions" USING btree ("completed_media_asset_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_owner_client_uidx"
	ON "media_upload_sessions" USING btree ("owner_user_id", "client_upload_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_upload_sessions_owner_status_idx"
	ON "media_upload_sessions" USING btree ("owner_user_id", "status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_upload_sessions_provider_event_idx"
	ON "media_upload_sessions" USING btree ("storage_provider", "provider_event_at");
