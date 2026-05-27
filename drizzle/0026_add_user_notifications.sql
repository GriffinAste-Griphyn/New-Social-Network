DO $$ BEGIN
  CREATE TYPE "public"."notification_type" AS ENUM('follow', 'reply');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "type" "public"."notification_type" NOT NULL,
  "entity_id" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_actor_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_actor_user_id_users_id_fk"
      FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_type_entity_idx"
  ON "notifications" USING btree ("user_id","type","entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
  ON "notifications" USING btree ("user_id","read_at","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_actor_idx"
  ON "notifications" USING btree ("actor_user_id","created_at");
