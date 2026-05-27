CREATE INDEX IF NOT EXISTS "story_mentions_story_id_idx" ON "story_mentions" USING btree ("story_id", "created_at");
