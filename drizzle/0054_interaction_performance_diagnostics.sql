ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'image_ready';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'interaction_latency';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'keyboard_latency';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'gesture_outcome';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'frame_hitch';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'prefetch_intent';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'resource_mode';
ALTER TYPE "public"."mobile_performance_event_name"
  ADD VALUE IF NOT EXISTS 'undo_action';
