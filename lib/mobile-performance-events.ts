import { randomUUID } from "node:crypto"

import { getDb } from "@/lib/db"
import { mobilePerformanceEvents } from "@/lib/db/schema"

export const mobilePerformanceEventNames = [
  "api_request",
  "api_server_timing",
  "feed_disk_cache_clear",
  "feed_disk_cache_hit",
  "feed_disk_cache_miss",
  "feed_disk_cache_restore",
  "feed_disk_cache_write",
  "feed_disk_restore",
  "feed_load",
  "feed_media_preheat",
  "feed_refresh_failed",
  "media_cache_summary",
  "media_file_cache_failed",
  "media_file_cache_hit",
  "media_file_cache_skip",
  "media_file_cache_write",
  "story_open",
  "story_open_warm",
  "story_stack_cache_clear",
  "story_stack_cache_hit",
  "story_stack_cache_miss",
  "story_stack_disk_cache_hit",
  "story_stack_disk_cache_miss",
  "story_stack_disk_cache_write",
  "story_stack_disk_restore",
  "story_stack_display_cache_hit",
  "story_stack_fetch_join",
  "story_stack_network",
  "story_stack_prefetch_end",
  "story_stack_prefetch_start",
  "video_disk_cache_hit",
  "video_first_frame",
  "video_item_ready",
  "video_stalled",
] as const

export type MobilePerformanceEventName =
  (typeof mobilePerformanceEventNames)[number]

type MobilePerformanceEventInput = {
  name: MobilePerformanceEventName
  durationMs?: number | null
  metadata?: Record<string, string | number | boolean | null>
  clientCreatedAt?: Date | null
}

export async function recordMobilePerformanceEvents(input: {
  userId: string
  events: MobilePerformanceEventInput[]
}) {
  if (input.events.length === 0) {
    return { accepted: 0 }
  }

  await getDb().insert(mobilePerformanceEvents).values(
    input.events.map((event) => ({
      id: randomUUID(),
      userId: input.userId,
      name: event.name,
      durationMs: event.durationMs ?? null,
      metadata: event.metadata ?? {},
      clientCreatedAt: event.clientCreatedAt ?? null,
    })),
  )

  return { accepted: input.events.length }
}
