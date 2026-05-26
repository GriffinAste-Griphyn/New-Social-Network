ALTER TYPE "public"."story_element_kind" ADD VALUE IF NOT EXISTS 'quote_reply';

ALTER TABLE "story_elements" ADD COLUMN "source_interaction_id" text;
ALTER TABLE "story_elements" ADD COLUMN "source_actor_name" text;
ALTER TABLE "story_elements" ADD COLUMN "source_actor_handle" text;
ALTER TABLE "story_elements" ADD COLUMN "source_actor_avatar_url" text;

ALTER TABLE "story_elements" ADD CONSTRAINT "story_elements_source_interaction_id_story_interactions_id_fk" FOREIGN KEY ("source_interaction_id") REFERENCES "public"."story_interactions"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "story_elements_source_interaction_idx" ON "story_elements" USING btree ("source_interaction_id");
