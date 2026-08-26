ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'feed_media_commit';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'feed_media_deferred';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'feed_media_preparation';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'thumbnail_generation_swap';
