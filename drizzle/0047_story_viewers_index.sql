CREATE INDEX IF NOT EXISTS "feed_impressions_story_viewer_created_idx"
  ON "feed_impressions" ("story_id", "viewer_id", "created_at");
