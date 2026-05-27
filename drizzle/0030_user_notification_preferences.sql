DO $$ BEGIN
  CREATE TYPE "public"."user_notification_preference_type" AS ENUM(
    'creator_stories',
    'replies',
    'follows'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
  "user_id" text NOT NULL,
  "type" "public"."user_notification_preference_type" NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" DROP CONSTRAINT IF EXISTS "user_notification_preferences_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_notification_preferences"
  ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notification_preferences_user_idx"
  ON "user_notification_preferences" USING btree ("user_id","updated_at");
