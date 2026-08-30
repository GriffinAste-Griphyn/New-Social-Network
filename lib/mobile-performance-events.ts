import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"

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
  "feed_media_commit",
  "feed_media_deferred",
  "feed_media_preparation",
  "feed_media_preheat",
  "feed_refresh_failed",
  "media_cache_summary",
  "media_file_cache_failed",
  "media_file_cache_hit",
  "media_file_cache_skip",
  "media_file_cache_write",
  "hls_asset_download_failed",
  "hls_asset_download_finished",
  "hls_asset_download_start",
  "hls_asset_package_hit",
  "media_qoe_config",
  "image_derivatives_prepared",
  "image_derivative_upload_failed",
  "image_ready",
  "interaction_latency",
  "keyboard_latency",
  "gesture_outcome",
  "frame_hitch",
  "prefetch_intent",
  "resource_mode",
  "undo_action",
  "thumbnail_generation_swap",
  "background_upload_resume",
  "silent_push_prewarm",
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
  "story_transition_visible",
  "video_disk_cache_hit",
  "video_dismissed",
  "video_ended",
  "video_player_pool_hit",
  "video_player_pool_wait",
  "video_player_prepared",
  "video_player_staged",
  "video_preroll_reused",
  "video_prerolled",
  "video_retry",
  "video_recovered",
  "video_startup",
  "video_upload_failed",
  "video_upload_phase",
  "video_upload_retry",
  "video_upload_succeeded",
  "video_first_frame",
  "video_item_ready",
  "video_stalled",
  "video_terminal_failure",
  "video_access_log",
  "video_quality_ramp",
] as const

export type MobilePerformanceEventName =
  (typeof mobilePerformanceEventNames)[number]

type MobilePerformanceEventInput = {
  name: MobilePerformanceEventName
  durationMs?: number | null
  metadata?: Record<string, string | number | boolean | null>
  clientCreatedAt?: Date | null
}

function stableMetadataKey(
  metadata: Record<string, string | number | boolean | null> | unknown,
) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "{}"
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(metadata).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  )
}

function eventKey(event: {
  name: string
  metadata?: Record<string, string | number | boolean | null> | unknown
  clientCreatedAt?: Date | null
}) {
  return [
    event.name,
    event.clientCreatedAt?.toISOString() ?? "",
    stableMetadataKey(event.metadata),
  ].join("|")
}

export async function recordMobilePerformanceEvents(input: {
  userId: string
  events: MobilePerformanceEventInput[]
}) {
  if (input.events.length === 0) {
    return { accepted: 0 }
  }

  const uniqueEvents: MobilePerformanceEventInput[] = []
  const seenIncoming = new Set<string>()
  for (const event of input.events) {
    const key = eventKey(event)
    if (seenIncoming.has(key)) {
      continue
    }

    seenIncoming.add(key)
    uniqueEvents.push(event)
  }

  const clientCreatedAts = Array.from(
    new Set(
      uniqueEvents
        .map((event) => event.clientCreatedAt?.toISOString())
        .filter((value): value is string => Boolean(value)),
    ),
  ).map((value) => new Date(value))

  const db = getDb()
  const existingKeys = new Set<string>()
  if (clientCreatedAts.length > 0) {
    const existing = await db
      .select({
        name: mobilePerformanceEvents.name,
        metadata: mobilePerformanceEvents.metadata,
        clientCreatedAt: mobilePerformanceEvents.clientCreatedAt,
      })
      .from(mobilePerformanceEvents)
      .where(
        and(
          eq(mobilePerformanceEvents.userId, input.userId),
          inArray(mobilePerformanceEvents.clientCreatedAt, clientCreatedAts),
        ),
      )

    for (const event of existing) {
      existingKeys.add(eventKey(event))
    }
  }

  const newEvents = uniqueEvents.filter((event) => !existingKeys.has(eventKey(event)))

  if (newEvents.length === 0) {
    return { accepted: 0 }
  }

  await db.insert(mobilePerformanceEvents).values(
    newEvents.map((event) => ({
      id: randomUUID(),
      userId: input.userId,
      name: event.name,
      durationMs: event.durationMs ?? null,
      metadata: event.metadata ?? {},
      clientCreatedAt: event.clientCreatedAt ?? null,
    })),
  )

  return { accepted: newEvents.length }
}
