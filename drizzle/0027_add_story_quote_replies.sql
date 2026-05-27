ALTER TYPE "public"."story_element_kind" ADD VALUE IF NOT EXISTS 'quote_reply';
--> statement-breakpoint
ALTER TABLE "story_elements" ADD COLUMN IF NOT EXISTS "source_interaction_id" text;
--> statement-breakpoint
ALTER TABLE "story_elements" ADD COLUMN IF NOT EXISTS "source_actor_name" text;
--> statement-breakpoint
ALTER TABLE "story_elements" ADD COLUMN IF NOT EXISTS "source_actor_handle" text;
--> statement-breakpoint
ALTER TABLE "story_elements" ADD COLUMN IF NOT EXISTS "source_actor_avatar_url" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'story_elements_source_interaction_id_story_interactions_id_fk'
  ) THEN
    ALTER TABLE "story_elements"
      ADD CONSTRAINT "story_elements_source_interaction_id_story_interactions_id_fk"
      FOREIGN KEY ("source_interaction_id") REFERENCES "public"."story_interactions"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "story_elements_source_interaction_idx" ON "story_elements" USING btree ("source_interaction_id");
