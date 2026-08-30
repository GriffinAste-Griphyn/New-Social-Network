import { randomUUID } from "node:crypto"

import {
  asc,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  or,
} from "drizzle-orm"
import type { SocialStoryCard } from "@ubeye/shared"

import type { CompleteAuthSession } from "@/lib/auth"
import {
  reverseUnpaidStoryEarnings,
} from "@/lib/creator-earnings"
import { getDb } from "@/lib/db"
import {
  applyMediaModerationResult,
  createMediaAssetFromStoredStoryAsset,
} from "@/lib/media-assets"
import { enqueueMediaProcessing } from "@/lib/media-pipeline/jobs"
import { moderateUserContent } from "@/lib/safety/moderate-content"
import { recordModerationCheck } from "@/lib/safety/moderation-checks"
import type { ContentModerationResult } from "@/lib/safety/policy"
import {
  creatorProfiles,
  creatorScores,
  mediaAssets,
  stories,
  storyElements,
  storyInteractions,
  storyMentions,
  users,
} from "@/lib/db/schema"
import {
  invalidateMobileFeedSnapshotsForCreator,
  readMobileFeedSnapshot,
  readFreshMobileFeedSnapshot,
  writeMobileFeedSnapshot,
} from "@/lib/feed-snapshot-store"
import { listFollowingProfiles } from "@/lib/follow-store"
import { formatStoryPostedAt } from "@/lib/story-time"
import { enqueueStoryPublication } from "@/lib/story-publication"
import { enqueueStoryModeration } from "@/lib/story-moderation"
import {
  publicStoryMediaUrl,
  StoryUploadError,
  type StoredStoryAsset,
} from "@/lib/story-storage"
import {
  deriveStoryPublicationStatus,
  refreshProcessingCloudflareStories,
} from "@/lib/stories/cloudflare-status"
import { getBlockedPeerIds, isBlockedBetween } from "@/lib/social-safety"
import {
  extractCaptionMentions,
  normalizeStoryTextOverlay,
  type StoryElementInput,
} from "@/lib/story-validators"

export {
  getStoryUploadStatusForOwner,
  syncCloudflareStreamStoryStatus,
} from "@/lib/stories/cloudflare-status"

const MY_STORY_ROUTE_ID = "my-story"
const storyVideoSegmentSeconds = 10
const minFinalVideoSegmentSeconds = 2

type FeedStoryRow = {
  id: string
  creatorId: string
  creatorName: string
  creatorHandle: string
  creatorAvatarUrl: string | null
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl: string | null
  storageProvider: string | null
  storageKey: string | null
  contentType: string | null
  byteSize: number | null
  checksum: string | null
  width: number | null
  height: number | null
  originalMediaUrl: string | null
  originalThumbnailUrl: string | null
  originalStorageProvider: string | null
  originalStorageKey: string | null
  originalContentType: string | null
  originalByteSize: number | null
  originalChecksum: string | null
  originalWidth: number | null
  originalHeight: number | null
  originalDurationMs: number | null
  caption: string | null
  durationMs: number | null
  processingStatus: string
  brandSignalScore: string | null
  createdAt: Date
  expiresAt: Date
  freshnessScore: string | null
  qualityScore: string | null
  affinityScore: string | null
  monetizationScore: string | null
}

type StoryMentionRecord = {
  storyId: string
  brandSlug: string
  mentionType: "tag" | "text" | "detected"
}

type StoryElementRecord = {
  id: string
  storyId: string
  kind: "text" | "sticker" | "link" | "quote_reply"
  label: string
  href: string | null
  sourceInteractionId: string | null
  sourceActorName: string | null
  sourceActorHandle: string | null
  sourceActorAvatarUrl: string | null
  positionX: string | null
  positionY: string | null
}

type StoryOverlayElementRecord = StoryElementRecord & {
  kind: "text" | "link" | "quote_reply"
}

type RankedStoryRow = FeedStoryRow & {
  feedScore: number
}

type StoryMediaRendition = {
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl?: string | null
  storageProvider?: string | null
  storageKey?: string | null
  contentType?: string | null
  byteSize?: number | null
  checksum?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  processingStatus?: string | null
}

type StoryMediaRenditions = {
  playback: StoryMediaRendition
  original: StoryMediaRendition | null
}

function toCompleteStoryRow<T extends {
  creatorName: string | null
  creatorHandle: string | null
}>(row: T): (Omit<T, "creatorName" | "creatorHandle"> & {
  creatorName: string
  creatorHandle: string
}) | null {
  if (!row.creatorName || !row.creatorHandle) {
    return null
  }

  return {
    ...row,
    creatorName: row.creatorName,
    creatorHandle: row.creatorHandle,
  }
}

function storyMediaRenditions(row: FeedStoryRow): StoryMediaRenditions {
  const playbackMediaUrl = publicStoryMediaUrl(row.mediaUrl) ?? row.mediaUrl
  const playbackThumbnailUrl = publicStoryMediaUrl(row.thumbnailUrl)

  const isCfVideo =
    row.assetKind === "video" &&
    (row.storageProvider === "cloudflare-stream" ||
      (row.originalStorageProvider ?? null) === "cloudflare-stream" ||
      (row.storageKey != null && /^[a-f0-9]{32}$/i.test(row.storageKey ?? "")))

  return {
    playback: {
      mediaUrl: playbackMediaUrl,
      thumbnailUrl: playbackThumbnailUrl,
      placeholderUrl: publicStoryMediaUrl(row.placeholderUrl),
      storageProvider: row.storageProvider,
      storageKey: row.storageKey,
      contentType: row.contentType,
      byteSize: row.byteSize,
      checksum: row.checksum,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      processingStatus: row.processingStatus,
    },
    original:
      isCfVideo
        ? null
        : row.originalMediaUrl
          ? {
              mediaUrl:
                publicStoryMediaUrl(row.originalMediaUrl) ??
                row.originalMediaUrl,
              thumbnailUrl: publicStoryMediaUrl(row.originalThumbnailUrl),
              placeholderUrl: publicStoryMediaUrl(row.placeholderUrl),
              storageProvider: row.originalStorageProvider,
              storageKey: row.originalStorageKey,
              contentType: row.originalContentType,
              byteSize: row.originalByteSize,
              checksum: row.originalChecksum,
              width: row.originalWidth,
              height: row.originalHeight,
              durationMs: row.originalDurationMs,
              processingStatus: "ready",
            }
          : null,
  }
}

export type FeedStory = {
  id: string
  creator: string
  handle: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  caption: string
  tags: string[]
  payoutHint: string
  engagement: string
}

export type SuggestedAccount = {
  id: string
  name: string
  handle: string
  imageUrl: string | null
  storyStreak: string
  reason: string
  monetization: string
}

export type FeedStoryCard = SocialStoryCard & {
  placeholderUrl?: string | null
  processingStatus?: string
  renditions?: StoryMediaRenditions
}

export type MyStoryElement = {
  id: string
  kind: "text" | "sticker" | "link" | "quote_reply"
  label: string
  href: string | null
  sourceInteractionId: string | null
  sourceActorName: string | null
  sourceActorHandle: string | null
  sourceActorAvatarUrl: string | null
  positionX: number
  positionY: number
}

export type MyStoryItem = FeedStoryCard & {
  caption: string
  createdAt: string
  expiresAt: string
  minutesRemaining: number
  brandTags: string[]
  elements: MyStoryElement[]
}

export type MyStorySummary = {
  owner: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  }
  hasActiveStory: boolean
  liveCount: number
  latestThumbnailUrl: string | null
  latestAssetKind: "image" | "video" | null
  expiresSoonLabel: string | null
  items: MyStoryItem[]
}

export type FeedData = {
  featuredStory: FeedStory | null
  myStory: MyStorySummary
  followingProfiles: Awaited<ReturnType<typeof listFollowingProfiles>>
  followingStories: FeedStoryCard[]
  followingTimelineStories: FeedStoryCard[]
  suggestedAccounts: SuggestedAccount[]
  discoverStories: FeedStoryCard[]
}

export type StoryStackItem = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl: string | null
  renditions?: StoryMediaRenditions
  processingStatus?: string
  title: string
  postedAt: string
  durationSeconds?: number
  captionVerticalPercent?: number
  textOverlays: Array<{
    id: string
    label: string
    kind: "text" | "link" | "quote_reply"
    href: string | null
    sourceInteractionId: string | null
    sourceActorName: string | null
    sourceActorHandle: string | null
    sourceActorAvatarUrl: string | null
    positionX: number
    positionY: number
  }>
}

export type StoryStack = {
  id: string
  creatorId: string
  creator: string
  handle: string
  avatarUrl: string | null
  items: StoryStackItem[]
}

export type MobileCreatorProfile = {
  id: string
  name: string
  handle: string
  category: string
  avatarUrl: string | null
  coverUrl: string | null
  hasActiveStory: boolean
}

type FeedDataOptions = {
  refreshProcessing?: boolean
  useSnapshot?: boolean
  timelineStoryIds?: string[]
  timelineCursor?: { createdAt: Date; id: string } | null
  timelineLimit?: number
}

type CreateStoryInput = {
  session: CompleteAuthSession
  caption: string
  explicitBrandTags: string[]
  elements: StoryElementInput[]
  storedAsset: StoredStoryAsset
  createdAt?: Date
  moderationMediaUrl?: string | null
  moderationThumbnailUrl?: string | null
  deferModeration?: boolean
}

type StoredAssetStory = {
  id: string
  assetKind: "image" | "video"
  mediaUrl: string
  thumbnailUrl: string | null
  placeholderUrl?: string | null
  storageProvider?: string | null
  storageKey?: string | null
  contentType?: string | null
  byteSize?: number | null
  checksum?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  originalMediaUrl?: string | null
  originalThumbnailUrl?: string | null
  originalStorageProvider?: string | null
  originalStorageKey?: string | null
  originalContentType?: string | null
  originalByteSize?: number | null
  originalChecksum?: string | null
  originalWidth?: number | null
  originalHeight?: number | null
  originalDurationMs?: number | null
  processingStatus: string
}

type UpdateStoryInput = {
  storyId: string
  ownerId: string
  caption: string
  explicitBrandTags: string[]
  elements: StoryElementInput[]
}

function numericStringToNumber(value: string | null | undefined) {
  if (!value) {
    return 0
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

function positionStringToNumber(
  value: string | null | undefined,
  fallback: number,
) {
  if (value == null) {
    return fallback
  }

  return Math.min(Math.max(numericStringToNumber(value), 0), 100)
}

function isStoryOverlayElement(
  element: StoryElementRecord,
): element is StoryOverlayElementRecord {
  return (
    element.kind === "text" ||
    element.kind === "link" ||
    element.kind === "quote_reply"
  )
}

function textOverlaysFromElements(elements: StoryElementRecord[]) {
  return elements
    .filter(isStoryOverlayElement)
    .map((element) => ({
      id: element.id,
      label:
        element.kind === "text"
          ? normalizeStoryTextOverlay(element.label)
          : element.label,
      kind: element.kind,
      href: element.href,
      sourceInteractionId: element.sourceInteractionId,
      sourceActorName: element.sourceActorName,
      sourceActorHandle: element.sourceActorHandle,
      sourceActorAvatarUrl: element.sourceActorAvatarUrl,
      positionX: positionStringToNumber(element.positionX, 50),
      positionY: positionStringToNumber(element.positionY, 74),
    }))
}

function formatLiveWindow(createdAt: Date) {
  const elapsedMs = Date.now() - createdAt.getTime()
  const elapsedHours = Math.max(0, elapsedMs / (1000 * 60 * 60))

  if (elapsedHours < 1) {
    return "Live now"
  }

  if (elapsedHours < 24) {
    return `${Math.floor(elapsedHours)}h live`
  }

  return `${Math.floor(elapsedHours / 24)}d live`
}

function rankStory(row: FeedStoryRow, mentionCount: number) {
  const freshnessScore = numericStringToNumber(row.freshnessScore)
  const qualityScore = numericStringToNumber(row.qualityScore)
  const affinityScore = numericStringToNumber(row.affinityScore)
  const monetizationScore = numericStringToNumber(row.monetizationScore)
  const brandSignalScore = numericStringToNumber(row.brandSignalScore)
  const ageHours = Math.max(
    0,
    (Date.now() - row.createdAt.getTime()) / (1000 * 60 * 60),
  )
  const freshnessBoost = Math.max(0, 36 - ageHours) / 3

  return (
    freshnessBoost +
    freshnessScore * 5 +
    qualityScore * 4 +
    affinityScore * 2 +
    monetizationScore * 3 +
    brandSignalScore / 20 +
    mentionCount * 2 +
    (row.assetKind === "video" ? 1.5 : 0.5)
  )
}

function buildFeedStory(row: FeedStoryRow, mentions: StoryMentionRecord[]): FeedStory {
  const mentionTags = mentions.slice(0, 3).map((mention) => `#${mention.brandSlug}`)
  const tags = [
    row.assetKind === "video" ? "Video story" : "Image story",
    ...mentionTags,
  ]

  return {
    id: row.id,
    creator: row.creatorName,
    handle: `@${row.creatorHandle}`,
    assetKind: row.assetKind,
    mediaUrl: publicStoryMediaUrl(row.mediaUrl) ?? row.mediaUrl,
    thumbnailUrl: publicStoryMediaUrl(row.thumbnailUrl),
    caption:
      row.caption?.trim() ||
      "Fresh story in the feed. Uploads land here the second they go live.",
    tags,
    payoutHint:
      mentions.length > 0
        ? "Eligible for brand match + viewer pool"
        : "Eligible for viewer pool",
    engagement: formatLiveWindow(row.createdAt),
  }
}

function buildSuggestedAccount(
  row: FeedStoryRow,
  mentions: StoryMentionRecord[],
  liveStoryCount: number,
): SuggestedAccount {
  return {
    id: row.creatorId,
    name: row.creatorName,
    handle: `@${row.creatorHandle}`,
    imageUrl: row.creatorAvatarUrl,
    storyStreak: `${liveStoryCount} live stor${liveStoryCount === 1 ? "y" : "ies"}`,
    reason:
      mentions.length > 0
        ? "Recent tagged stories are making this account more relevant."
        : row.assetKind === "video"
          ? "Recent video uploads are earning fresh placement."
          : "Fresh image stories are holding recommendation weight.",
    monetization:
      mentions.length > 0
        ? `Tagged ${mentions.length} brand${mentions.length === 1 ? "" : "s"}`
        : "Open inventory for viewer ad-share",
  }
}

function buildFeedStoryCard(
  row: FeedStoryRow,
  mentions: StoryMentionRecord[],
  elements: StoryElementRecord[] = [],
  timelineSegmentCount = 1,
): FeedStoryCard {
  const ageHours = Math.max(
    0,
    (Date.now() - row.createdAt.getTime()) / (1000 * 60 * 60),
  )
  const freshnessRemaining = Math.max(0, 24 - ageHours)
  const progressPercent = Math.max(
    12,
    Math.min(96, Math.round((freshnessRemaining / 24) * 100)),
  )
  const textOverlays = textOverlaysFromElements(elements)
  const firstTextOverlay = textOverlays[0]

  return {
    id: row.id,
    creator: row.creatorName,
    handle: `@${row.creatorHandle}`,
    assetKind: row.assetKind,
    mediaUrl: publicStoryMediaUrl(row.mediaUrl) ?? row.mediaUrl,
    thumbnailUrl: publicStoryMediaUrl(row.thumbnailUrl),
    placeholderUrl: publicStoryMediaUrl(row.placeholderUrl),
    renditions: storyMediaRenditions(row),
    processingStatus: row.processingStatus,
    title:
      row.assetKind === "video" && row.processingStatus === "processing"
        ? "Video processing"
        : firstTextOverlay?.label.trim() ||
          row.caption?.trim() ||
          (mentions.length > 0
            ? "Fresh story with tags moving through the feed."
            : "Fresh story moving through the feed."),
    textOverlays,
    durationSeconds:
      row.assetKind === "video"
        ? Math.max(1, Math.ceil((row.durationMs ?? 10_000) / 1_000))
        : undefined,
    lastUploadedAt: row.createdAt.toISOString(),
    progressPercent,
    timelineSegmentCount,
  }
}

function getStoryTimelineSegmentCount(row: FeedStoryRow) {
  if (row.assetKind === "image") {
    return 1
  }

  const durationSeconds = Math.max(
    row.durationMs ? Math.ceil(row.durationMs / 1_000) : storyVideoSegmentSeconds,
    1,
  )
  let segmentCount = 0

  for (let start = 0; start < durationSeconds; start += storyVideoSegmentSeconds) {
    const remainingSeconds = durationSeconds - start

    if (remainingSeconds < minFinalVideoSegmentSeconds && segmentCount > 0) {
      break
    }

    segmentCount += 1
  }

  return Math.max(1, segmentCount)
}

function getTimelineSegmentCountByCreator(rows: FeedStoryRow[]) {
  const segmentCountByCreator = new Map<string, number>()

  rows.forEach((row) => {
    segmentCountByCreator.set(
      row.creatorId,
      (segmentCountByCreator.get(row.creatorId) ?? 0) +
        getStoryTimelineSegmentCount(row),
    )
  })

  return segmentCountByCreator
}

function moderationStatusFromResult(result: ContentModerationResult) {
  return result.action === "approve"
    ? "approved"
    : result.action === "reject"
      ? "rejected"
      : "flagged"
}

function storyModerationTextParts(input: {
  caption: string
  explicitBrandTags: string[]
  elements: StoryElementInput[]
}) {
  return [
    input.caption,
    input.explicitBrandTags.join(" "),
    ...input.elements.map((element) => element.label),
  ]
}

function storyModerationLinkUrls(elements: StoryElementInput[]) {
  return elements.flatMap((element) => (element.href ? [element.href] : []))
}

function truncateQuoteReplyLabel(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ")

  if (trimmed.length <= 240) {
    return trimmed
  }

  return `${trimmed.slice(0, 237).trimEnd()}...`
}

async function resolveStoryElementsForOwner(input: {
  ownerId: string
  elements: StoryElementInput[]
}) {
  const quoteIds = [
    ...new Set(
      input.elements
        .filter((element) => element.kind === "quote_reply")
        .flatMap((element) =>
          element.sourceInteractionId ? [element.sourceInteractionId] : [],
        ),
    ),
  ]

  if (quoteIds.length === 0) {
    return input.elements
  }

  const db = getDb()
  const rows = await db
    .select({
      id: storyInteractions.id,
      actorId: storyInteractions.actorId,
      body: storyInteractions.body,
      reaction: storyInteractions.reaction,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(storyInteractions)
    .innerJoin(users, eq(users.id, storyInteractions.actorId))
    .where(
      and(
        inArray(storyInteractions.id, quoteIds),
        eq(storyInteractions.creatorId, input.ownerId),
        eq(storyInteractions.moderationStatus, "approved"),
        inArray(storyInteractions.kind, ["reply", "comment"]),
      ),
    )

  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const blockedActorIds = new Set<string>()

  for (const row of rows) {
    if (await isBlockedBetween(input.ownerId, row.actorId)) {
      blockedActorIds.add(row.actorId)
    }
  }

  return input.elements.map((element) => {
    if (element.kind !== "quote_reply") {
      return element
    }

    const quoteId = element.sourceInteractionId
    const row = quoteId ? rowsById.get(quoteId) : undefined
    const quoteText = row?.body?.trim() || row?.reaction?.trim() || ""

    if (!quoteId || !row || blockedActorIds.has(row.actorId) || !quoteText) {
      throw new StoryUploadError("That reply is no longer available to quote.")
    }

    return {
      ...element,
      label: truncateQuoteReplyLabel(quoteText),
      sourceInteractionId: quoteId,
      sourceActorName: row.displayName ?? row.handle ?? "Someone",
      sourceActorHandle: row.handle,
      sourceActorAvatarUrl: row.avatarUrl,
    }
  })
}

function firstStoryPerCreator<T extends { creatorId: string }>(rows: T[]) {
  const seenCreatorIds = new Set<string>()
  const firstStories: T[] = []

  rows.forEach((row) => {
    if (seenCreatorIds.has(row.creatorId)) {
      return
    }

    seenCreatorIds.add(row.creatorId)
    firstStories.push(row)
  })

  return firstStories
}

function orderStoriesChronologically<T extends { createdAt: Date }>(rows: T[]) {
  return [...rows].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  )
}

function getLatestStory<T extends { createdAt: Date }>(rows: T[]) {
  return rows.reduce<T | null>((latest, row) => {
    if (!latest || row.createdAt.getTime() > latest.createdAt.getTime()) {
      return row
    }

    return latest
  }, null)
}

function buildStoryStack(
  rows: FeedStoryRow[],
  elementsByStory: Map<string, StoryElementRecord[]> = new Map(),
): StoryStack | null {
  const first = rows[0]

  if (!first) {
    return null
  }

  const chronologicalRows = orderStoriesChronologically(rows)

  return {
    id: first.id,
    creatorId: first.creatorId,
    creator: first.creatorName,
    handle: `@${first.creatorHandle}`,
    avatarUrl: first.creatorAvatarUrl,
    items: chronologicalRows.map((row) => ({
      ...(() => {
        const textOverlays = textOverlaysFromElements(
          elementsByStory.get(row.id) ?? [],
        )
        const firstTextOverlay = textOverlays[0]

        return {
          title: firstTextOverlay?.label.trim() || row.caption?.trim() || "",
          captionVerticalPercent: firstTextOverlay?.positionY ?? 74,
          textOverlays,
        }
      })(),
      id: row.id,
      assetKind: row.assetKind,
      mediaUrl: publicStoryMediaUrl(row.mediaUrl) ?? row.mediaUrl,
      thumbnailUrl: publicStoryMediaUrl(row.thumbnailUrl),
      placeholderUrl: publicStoryMediaUrl(row.placeholderUrl),
      renditions: storyMediaRenditions(row),
      processingStatus: row.processingStatus,
      postedAt: formatStoryPostedAt(row.createdAt),
      durationSeconds:
        row.assetKind === "video"
          ? Math.max(1, Math.ceil((row.durationMs ?? 10_000) / 1_000))
          : undefined,
    })),
  }
}

function formatExpiresSoonLabel(minutesRemaining: number) {
  if (minutesRemaining < 60) {
    return `${Math.max(1, minutesRemaining)}m left`
  }

  return `${Math.ceil(minutesRemaining / 60)}h left`
}

function buildMyStorySummary(
  owner: {
    id: string
    name: string
    handle: string
    imageUrl: string | null
  },
  rows: FeedStoryRow[],
  mentionsByStory: Map<string, StoryMentionRecord[]>,
  elementsByStory: Map<string, StoryElementRecord[]>,
): MyStorySummary {
  const chronologicalRows = orderStoriesChronologically(rows)
  const items = chronologicalRows.map((row) => {
    const expiresAtMs = row.expiresAt.getTime()
    const minutesRemaining = Math.max(
      0,
      Math.ceil((expiresAtMs - Date.now()) / (1000 * 60)),
    )
    const mentions = mentionsByStory.get(row.id) ?? []

    return {
      ...buildFeedStoryCard(row, mentions, elementsByStory.get(row.id) ?? []),
      caption: row.caption?.trim() ?? "",
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      minutesRemaining,
      brandTags: mentions.map((mention) => mention.brandSlug),
      elements: (elementsByStory.get(row.id) ?? []).map((element) => ({
        id: element.id,
        kind: element.kind,
        label:
          element.kind === "text"
            ? normalizeStoryTextOverlay(element.label)
            : element.label,
        href: element.href,
        sourceInteractionId: element.sourceInteractionId,
        sourceActorName: element.sourceActorName,
        sourceActorHandle: element.sourceActorHandle,
        sourceActorAvatarUrl: element.sourceActorAvatarUrl,
        positionX: positionStringToNumber(element.positionX, 50),
        positionY: positionStringToNumber(element.positionY, 74),
      })),
    }
  })
  const latestRow = getLatestStory(rows)
  const latest = latestRow
    ? items.find((item) => item.id === latestRow.id) ?? null
    : null
  const shortestWindow = items.reduce<number | null>((current, item) => {
    if (current === null) {
      return item.minutesRemaining
    }

    return Math.min(current, item.minutesRemaining)
  }, null)

  return {
    owner,
    hasActiveStory: items.length > 0,
    liveCount: items.length,
    latestThumbnailUrl:
      latest?.thumbnailUrl ??
      (latest?.assetKind === "image" ? latest.mediaUrl : null),
    latestAssetKind: latest?.assetKind ?? null,
    expiresSoonLabel:
      shortestWindow === null ? null : formatExpiresSoonLabel(shortestWindow),
    items,
  }
}

async function getLiveStoryRows(
  storyIds?: string[],
  options: {
    cursor?: { createdAt: Date; id: string } | null
    limit?: number
  } = {},
) {
  const db = getDb()

  const rows = await db
    .select({
      id: stories.id,
      creatorId: users.id,
      creatorName: users.displayName,
      creatorHandle: users.handle,
      creatorAvatarUrl: users.avatarUrl,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      placeholderUrl: stories.placeholderUrl,
      storageProvider: stories.storageProvider,
      storageKey: stories.storageKey,
      contentType: stories.contentType,
      byteSize: stories.byteSize,
      checksum: stories.checksum,
      width: stories.width,
      height: stories.height,
      originalMediaUrl: stories.originalMediaUrl,
      originalThumbnailUrl: stories.originalThumbnailUrl,
      originalStorageProvider: stories.originalStorageProvider,
      originalStorageKey: stories.originalStorageKey,
      originalContentType: stories.originalContentType,
      originalByteSize: stories.originalByteSize,
      originalChecksum: stories.originalChecksum,
      originalWidth: stories.originalWidth,
      originalHeight: stories.originalHeight,
      originalDurationMs: stories.originalDurationMs,
      caption: stories.caption,
      durationMs: stories.durationMs,
      processingStatus: stories.processingStatus,
      brandSignalScore: stories.brandSignalScore,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt,
      freshnessScore: creatorScores.freshnessScore,
      qualityScore: creatorScores.qualityScore,
      affinityScore: creatorScores.affinityScore,
      monetizationScore: creatorScores.monetizationScore,
    })
    .from(stories)
    .innerJoin(users, eq(stories.creatorId, users.id))
    .leftJoin(creatorScores, eq(creatorScores.creatorId, users.id))
    .where(
      and(
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
        storyIds && storyIds.length > 0
          ? inArray(stories.id, storyIds)
          : undefined,
        options.cursor
          ? or(
              lt(stories.createdAt, options.cursor.createdAt),
              and(
                eq(stories.createdAt, options.cursor.createdAt),
                lt(stories.id, options.cursor.id),
              ),
            )
          : undefined,
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(stories.createdAt), desc(stories.id))
    .limit(
      Math.min(
        options.limit ?? (storyIds ? storyIds.length : 24),
        50,
      ),
    )

  return rows.flatMap((row) => {
    const story = toCompleteStoryRow(row)

    return story ? [story] : []
  })
}

async function getLiveStoryRowsForCreator(
  creatorId: string,
  options: { includeOwnerProcessing?: boolean } = {},
) {
  const db = getDb()
  const statusFilter = options.includeOwnerProcessing
    ? inArray(stories.status, ["live", "processing"])
    : eq(stories.status, "live")
  const moderationFilter = options.includeOwnerProcessing
    ? inArray(stories.moderationStatus, ["approved", "pending"])
    : eq(stories.moderationStatus, "approved")

  const rows = await db
    .select({
      id: stories.id,
      creatorId: users.id,
      creatorName: users.displayName,
      creatorHandle: users.handle,
      creatorAvatarUrl: users.avatarUrl,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      placeholderUrl: stories.placeholderUrl,
      storageProvider: stories.storageProvider,
      storageKey: stories.storageKey,
      contentType: stories.contentType,
      byteSize: stories.byteSize,
      checksum: stories.checksum,
      width: stories.width,
      height: stories.height,
      originalMediaUrl: stories.originalMediaUrl,
      originalThumbnailUrl: stories.originalThumbnailUrl,
      originalStorageProvider: stories.originalStorageProvider,
      originalStorageKey: stories.originalStorageKey,
      originalContentType: stories.originalContentType,
      originalByteSize: stories.originalByteSize,
      originalChecksum: stories.originalChecksum,
      originalWidth: stories.originalWidth,
      originalHeight: stories.originalHeight,
      originalDurationMs: stories.originalDurationMs,
      caption: stories.caption,
      durationMs: stories.durationMs,
      processingStatus: stories.processingStatus,
      brandSignalScore: stories.brandSignalScore,
      createdAt: stories.createdAt,
      expiresAt: stories.expiresAt,
      freshnessScore: creatorScores.freshnessScore,
      qualityScore: creatorScores.qualityScore,
      affinityScore: creatorScores.affinityScore,
      monetizationScore: creatorScores.monetizationScore,
    })
    .from(stories)
    .innerJoin(users, eq(stories.creatorId, users.id))
    .leftJoin(creatorScores, eq(creatorScores.creatorId, users.id))
    .where(
      and(
        eq(stories.creatorId, creatorId),
        statusFilter,
        moderationFilter,
        gt(stories.expiresAt, new Date()),
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(stories.createdAt))

  return rows.flatMap((row) => {
    const story = toCompleteStoryRow(row)

    return story ? [story] : []
  })
}

async function getStoryMentions(storyIds: string[]) {
  if (storyIds.length === 0) {
    return []
  }

  const db = getDb()

  return db
    .select({
      storyId: storyMentions.storyId,
      brandSlug: storyMentions.brandSlug,
      mentionType: storyMentions.mentionType,
    })
    .from(storyMentions)
    .where(inArray(storyMentions.storyId, storyIds))
}

async function getStoryElements(storyIds: string[]) {
  if (storyIds.length === 0) {
    return []
  }

  const db = getDb()

  return db
    .select({
      id: storyElements.id,
      storyId: storyElements.storyId,
      kind: storyElements.kind,
      label: storyElements.label,
      href: storyElements.href,
      sourceInteractionId: storyElements.sourceInteractionId,
      sourceActorName: storyElements.sourceActorName,
      sourceActorHandle: storyElements.sourceActorHandle,
      sourceActorAvatarUrl: storyElements.sourceActorAvatarUrl,
      positionX: storyElements.positionX,
      positionY: storyElements.positionY,
    })
    .from(storyElements)
    .where(inArray(storyElements.storyId, storyIds))
    .orderBy(asc(storyElements.createdAt))
}

export async function getStoryTextOverlaysForOwner(
  storyId: string,
  ownerId: string,
) {
  const db = getDb()
  const elements = await db
    .select({
      id: storyElements.id,
      storyId: storyElements.storyId,
      kind: storyElements.kind,
      label: storyElements.label,
      href: storyElements.href,
      sourceInteractionId: storyElements.sourceInteractionId,
      sourceActorName: storyElements.sourceActorName,
      sourceActorHandle: storyElements.sourceActorHandle,
      sourceActorAvatarUrl: storyElements.sourceActorAvatarUrl,
      positionX: storyElements.positionX,
      positionY: storyElements.positionY,
    })
    .from(storyElements)
    .innerJoin(stories, eq(stories.id, storyElements.storyId))
    .where(and(eq(storyElements.storyId, storyId), eq(stories.creatorId, ownerId)))
    .orderBy(asc(storyElements.createdAt))

  return textOverlaysFromElements(elements)
}

function groupMentions(mentions: StoryMentionRecord[]) {
  const mentionsByStory = new Map<string, StoryMentionRecord[]>()

  mentions.forEach((mention) => {
    const currentMentions = mentionsByStory.get(mention.storyId) ?? []
    currentMentions.push(mention)
    mentionsByStory.set(mention.storyId, currentMentions)
  })

  return mentionsByStory
}

function groupElements(elements: StoryElementRecord[]) {
  const elementsByStory = new Map<string, StoryElementRecord[]>()

  elements.forEach((element) => {
    const currentElements = elementsByStory.get(element.storyId) ?? []
    currentElements.push(element)
    elementsByStory.set(element.storyId, currentElements)
  })

  return elementsByStory
}

export async function getMyStoryStack(
  viewerId: string,
  options: FeedDataOptions = {},
): Promise<MyStorySummary> {
  const db = getDb()
  const [owner] = await db
    .select({
      id: users.id,
      name: users.displayName,
      handle: users.handle,
      imageUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, viewerId))
    .limit(1)

  if (!owner || !owner.name || !owner.handle) {
    throw new Error("Your session is out of sync. Sign in again.")
  }

  const completeOwner = {
    ...owner,
    name: owner.name,
    handle: owner.handle,
  }

  if (options.refreshProcessing) {
    await refreshProcessingCloudflareStories({ creatorId: viewerId })
  }

  const rows = (
    await getLiveStoryRowsForCreator(viewerId, {
      includeOwnerProcessing: true,
    })
  ).filter((story) => story.id !== MY_STORY_ROUTE_ID)
  const storyIds = rows.map((story) => story.id)
  const [mentionRows, elementRows] = await Promise.all([
    getStoryMentions(storyIds),
    getStoryElements(storyIds),
  ])

  return buildMyStorySummary(
    completeOwner,
    rows,
    groupMentions(mentionRows),
    groupElements(elementRows),
  )
}

export async function getFeedData(
  viewerId: string,
  options: FeedDataOptions = {},
): Promise<FeedData> {
  if (options.useSnapshot !== false && !options.refreshProcessing) {
    const snapshot = await readFreshMobileFeedSnapshot(viewerId).catch(
      () => null,
    )

    if (snapshot) {
      return snapshot
    }
  }

  let feed: FeedData
  try {
    feed = await buildLiveFeedData(viewerId, options)
  } catch (error) {
    const staleSnapshot =
      options.useSnapshot !== false
        ? await readMobileFeedSnapshot(viewerId).catch(() => null)
        : null
    if (staleSnapshot) {
      return staleSnapshot
    }
    throw error
  }

  if (options.useSnapshot !== false && !options.refreshProcessing) {
    await writeMobileFeedSnapshot(viewerId, feed).catch(() => undefined)
  }

  return feed
}

async function buildLiveFeedData(
  viewerId: string,
  options: FeedDataOptions = {},
): Promise<FeedData> {
  const [recentStoryRows, timelineStoryRows, followingProfiles, myStory, blockedPeerIds] =
    await Promise.all([
      getLiveStoryRows(),
      options.timelineStoryIds?.length
        ? getLiveStoryRows(options.timelineStoryIds, {
            cursor: options.timelineCursor,
            limit: options.timelineLimit ?? 20,
          })
        : Promise.resolve([]),
      listFollowingProfiles(viewerId),
      getMyStoryStack(viewerId, options),
      getBlockedPeerIds(viewerId),
    ])
  const rawStoryRows = [
    ...timelineStoryRows,
    ...recentStoryRows.filter(
      (story) => !timelineStoryRows.some((candidate) => candidate.id === story.id),
    ),
  ]
  const storyRows = rawStoryRows.filter(
    (story) =>
      story.creatorId === viewerId || !blockedPeerIds.has(story.creatorId),
  )

  if (storyRows.length === 0) {
    return {
      featuredStory: null,
      myStory,
      followingProfiles,
      followingStories: [],
      followingTimelineStories: [],
      suggestedAccounts: [],
      discoverStories: [],
    }
  }

  const storyIds = storyRows.map((story) => story.id)
  const mentionRows = await getStoryMentions(storyIds)
  const mentionsByStory = groupMentions(mentionRows)

  const rankedStories: RankedStoryRow[] = storyRows
    .map((row) => ({
      ...row,
      feedScore: rankStory(row, (mentionsByStory.get(row.id) ?? []).length),
    }))
    .sort((left, right) => right.feedScore - left.feedScore)

  const followedCreatorIds = new Set(followingProfiles.map((profile) => profile.id))
  const followingRankedStories = rankedStories.filter((story) =>
    followedCreatorIds.has(story.creatorId),
  )
  const timelineOrder = new Map(
    (options.timelineStoryIds ?? []).map((storyId, index) => [storyId, index]),
  )
  const followingTimelineRows = storyRows
    .filter((story) => followedCreatorIds.has(story.creatorId))
    .sort((left, right) => {
      const leftIndex = timelineOrder.get(left.id)
      const rightIndex = timelineOrder.get(right.id)
      if (leftIndex !== undefined || rightIndex !== undefined) {
        return (leftIndex ?? Number.MAX_SAFE_INTEGER) -
          (rightIndex ?? Number.MAX_SAFE_INTEGER)
      }
      return right.createdAt.getTime() - left.createdAt.getTime()
    })
  const discoverRankedStories = rankedStories.filter(
    (story) =>
      story.creatorId !== viewerId && !followedCreatorIds.has(story.creatorId),
  )
  const latestDiscoverStoryByCreator = new Map(
    firstStoryPerCreator(
      storyRows.filter(
        (story) =>
          story.creatorId !== viewerId && !followedCreatorIds.has(story.creatorId),
      ),
    ).map((story) => [story.creatorId, story]),
  )
  const followingTimelineSegmentCountByCreator =
    getTimelineSegmentCountByCreator(followingRankedStories)
  const discoverTimelineSegmentCountByCreator =
    getTimelineSegmentCountByCreator(discoverRankedStories)
  const featuredRow = followingRankedStories[0]
  const featuredStory = featuredRow
    ? buildFeedStory(featuredRow, mentionsByStory.get(featuredRow.id) ?? [])
    : null

  const liveStoryCountByCreator = new Map<string, number>()

  rankedStories.forEach((story) => {
    liveStoryCountByCreator.set(
      story.creatorId,
      (liveStoryCountByCreator.get(story.creatorId) ?? 0) + 1,
    )
  })

  const suggestedAccounts: SuggestedAccount[] = []
  const seenCreatorIds = new Set<string>(followingProfiles.map((profile) => profile.id))

  discoverRankedStories.forEach((story) => {
    if (suggestedAccounts.length >= 4 || seenCreatorIds.has(story.creatorId)) {
      return
    }

    seenCreatorIds.add(story.creatorId)

    suggestedAccounts.push(
      buildSuggestedAccount(
        story,
        mentionsByStory.get(story.id) ?? [],
        liveStoryCountByCreator.get(story.creatorId) ?? 1,
      ),
    )
  })

  const followingStoryRows = firstStoryPerCreator(followingRankedStories).slice(
    0,
    8,
  )
  const followingTimelineStoryRows = firstStoryPerCreator(
    followingTimelineRows,
  ).slice(0, options.timelineLimit ?? 20)
  const discoverStoryRows = firstStoryPerCreator(discoverRankedStories)
    .slice(0, 8)
    .map((story) => latestDiscoverStoryByCreator.get(story.creatorId) ?? story)

  const visibleStoryIds = [
    ...followingStoryRows,
    ...followingTimelineStoryRows,
    ...discoverStoryRows,
  ].map((story) => story.id)
  const elementsByStory = groupElements(await getStoryElements(visibleStoryIds))

  const followingStories = followingStoryRows.map((story) =>
    buildFeedStoryCard(
      story,
      mentionsByStory.get(story.id) ?? [],
      elementsByStory.get(story.id) ?? [],
      followingTimelineSegmentCountByCreator.get(story.creatorId) ?? 1,
    ),
  )
  const followingTimelineStories = followingTimelineStoryRows.map((story) =>
    buildFeedStoryCard(
      story,
      mentionsByStory.get(story.id) ?? [],
      elementsByStory.get(story.id) ?? [],
      followingTimelineSegmentCountByCreator.get(story.creatorId) ?? 1,
    ),
  )

  const discoverStories = discoverStoryRows
    .map((story) =>
      buildFeedStoryCard(
        story,
        mentionsByStory.get(story.id) ?? [],
        elementsByStory.get(story.id) ?? [],
        discoverTimelineSegmentCountByCreator.get(story.creatorId) ?? 1,
      ),
    )

  return {
    featuredStory,
    myStory,
    followingProfiles,
    followingStories,
    followingTimelineStories,
    suggestedAccounts,
    discoverStories,
  }
}

export async function getStoryStackForStory(storyId: string, viewerId?: string) {

  const db = getDb()
  const [story] = await db
    .select({
      creatorId: stories.creatorId,
    })
    .from(stories)
    .where(
      and(
        eq(stories.id, storyId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!story) {
    return null
  }

  if (viewerId && story.creatorId !== viewerId) {
    const blocked = await isBlockedBetween(viewerId, story.creatorId)

    if (blocked) {
      return null
    }
  }

  const rows = await getLiveStoryRowsForCreator(story.creatorId)
  const elementRows = await getStoryElements(rows.map((row) => row.id))

  return buildStoryStack(rows, groupElements(elementRows))
}

export async function getMobileCreatorProfile(
  profileOrStoryId: string,
  viewerId?: string,
) {

  const db = getDb()
  const [directUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, profileOrStoryId))
    .limit(1)
  const [sourceStory] = directUser
    ? [null]
    : await db
        .select({ creatorId: stories.creatorId })
        .from(stories)
        .where(eq(stories.id, profileOrStoryId))
        .limit(1)
  const creatorId = directUser?.id ?? sourceStory?.creatorId

  if (!creatorId) {
    return null
  }

  if (viewerId && creatorId !== viewerId) {
    const blocked = await isBlockedBetween(viewerId, creatorId)

    if (blocked) {
      return null
    }
  }

  const [profile] = await db
    .select({
      id: users.id,
      name: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      category: creatorProfiles.category,
    })
    .from(users)
    .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
    .where(eq(users.id, creatorId))
    .limit(1)
  const [latestStory] = await db
    .select({
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      placeholderUrl: stories.placeholderUrl,
    })
    .from(stories)
    .where(
      and(
        eq(stories.creatorId, creatorId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(1)

  if (!profile?.name || !profile.handle) {
    return null
  }

  return {
    id: profile.id,
    name: profile.name,
    handle: profile.handle,
    category: profile.category ?? "Creator",
    avatarUrl: profile.avatarUrl,
    coverUrl:
      latestStory?.assetKind === "image"
        ? (publicStoryMediaUrl(latestStory.mediaUrl) ?? latestStory.mediaUrl)
        : (publicStoryMediaUrl(latestStory?.thumbnailUrl ?? null) ??
          profile.avatarUrl),
    hasActiveStory: Boolean(latestStory),
  } satisfies MobileCreatorProfile
}

export async function createStory(input: CreateStoryInput) {
  const db = getDb()
  const [creator] = await db
    .select({
      id: users.id,
      creatorStatus: users.creatorStatus,
    })
    .from(users)
    .where(eq(users.id, input.session.id))
    .limit(1)

  if (!creator) {
    throw new Error("Your session is out of sync. Sign in again.")
  }

  if (creator.creatorStatus !== "active") {
    throw new Error("Turn on posting before creating a story.")
  }

  await db
    .insert(creatorProfiles)
    .values({
      userId: creator.id,
    })
    .onConflictDoNothing()

  const elements = await resolveStoryElementsForOwner({
    ownerId: input.session.id,
    elements: input.elements,
  })
  const textMentions = extractCaptionMentions(input.caption)
  const mergedMentions = [
    ...input.explicitBrandTags.map((brandSlug) => ({
      brandSlug,
      mentionType: "tag" as const,
    })),
    ...textMentions
      .filter((brandSlug) => !input.explicitBrandTags.includes(brandSlug))
      .map((brandSlug) => ({
        brandSlug,
        mentionType: "text" as const,
      })),
  ]

  const brandSignalScore = Math.min(
    100,
    mergedMentions.reduce(
      (score, mention) => score + (mention.mentionType === "tag" ? 35 : 18),
      0,
    ),
  )
  const storyId = randomUUID()
  const now = new Date()
  const mediaAsset = await createMediaAssetFromStoredStoryAsset({
    ownerUserId: input.session.id,
    purpose: "story",
    storedAsset: input.storedAsset,
  })
  const mediaModerationReason =
    mediaAsset.scanStatus === "flagged" || mediaAsset.scanStatus === "failed"
      ? mediaAsset.scanReason ?? "Media upload was flagged by safety scanning."
      : null
  const mediaModerationUrl =
    input.moderationMediaUrl ??
    (input.storedAsset.assetKind === "image" ? input.storedAsset.mediaUrl : null)
  const mediaModerationThumbnailUrl =
    input.moderationThumbnailUrl ?? input.storedAsset.thumbnailUrl
  const contentModeration = input.deferModeration
    ? null
    : await moderateUserContent({
        textParts: storyModerationTextParts({ ...input, elements }),
        linkUrls: storyModerationLinkUrls(elements),
        media: {
          assetKind: input.storedAsset.assetKind,
          contentType: input.storedAsset.contentType,
          byteSize: input.storedAsset.byteSize,
          durationMs: input.storedAsset.durationMs,
          mediaUrl: mediaModerationUrl,
          thumbnailUrl: mediaModerationThumbnailUrl,
        },
      })
  const moderation: ContentModerationResult | null = contentModeration
    ? mediaModerationReason
      ? {
          action: "hold",
          provider: [contentModeration.provider, "local-media"].join("+"),
          reason: mediaModerationReason,
          categories: [
            ...contentModeration.categories,
            {
              key: "unsupported_media",
              confidence: 1,
              reason: mediaModerationReason,
              source: "local_media",
            },
          ],
          rawResult: contentModeration.rawResult,
          error: contentModeration.error,
        }
      : contentModeration
    : null
  const initialModerationStatus = moderation
    ? moderationStatusFromResult(moderation)
    : "pending"
  const isMediaReady = mediaAsset.processingStatus === "ready"
  const nextStoryStatus = deriveStoryPublicationStatus({
    currentStatus: "processing",
    moderationStatus: initialModerationStatus,
    providerReady:
      input.storedAsset.storageProvider === "cloudflare-stream"
        ? false
        : isMediaReady,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    now,
    scanStatus: mediaAsset.scanStatus,
  })

  if (moderation) {
    await applyMediaModerationResult({
      mediaAssetId: mediaAsset.id,
      actorUserId: input.session.id,
      result: moderation,
    }).catch(() => undefined)
  }

  await db
    .insert(creatorScores)
    .values({
      creatorId: input.session.id,
      freshnessScore: "0.650",
      affinityScore: "0.350",
      qualityScore: "0.500",
      monetizationScore: mergedMentions.length > 0 ? "0.550" : "0.250",
    })
    .onConflictDoNothing()

  await db.insert(stories).values({
    id: storyId,
    creatorId: input.session.id,
    assetKind: input.storedAsset.assetKind,
    mediaUrl: input.storedAsset.mediaUrl,
    thumbnailUrl: input.storedAsset.thumbnailUrl,
    placeholderUrl: input.storedAsset.placeholderUrl ?? null,
    storageProvider: input.storedAsset.storageProvider,
    storageKey: input.storedAsset.storageKey,
    originalMediaUrl: input.storedAsset.originalMediaUrl ?? null,
    originalThumbnailUrl: input.storedAsset.originalThumbnailUrl ?? null,
    originalStorageProvider: input.storedAsset.originalStorageProvider ?? null,
    originalStorageKey: input.storedAsset.originalStorageKey ?? null,
    originalContentType: input.storedAsset.originalContentType ?? null,
    originalByteSize: input.storedAsset.originalByteSize ?? null,
    originalChecksum: input.storedAsset.originalChecksum ?? null,
    originalWidth: input.storedAsset.originalWidth ?? null,
    originalHeight: input.storedAsset.originalHeight ?? null,
    originalDurationMs: input.storedAsset.originalDurationMs ?? null,
    contentType: input.storedAsset.contentType,
    byteSize: input.storedAsset.byteSize,
    checksum: input.storedAsset.checksum,
    mediaAssetId: mediaAsset.id,
    width: input.storedAsset.width,
    height: input.storedAsset.height,
    processingStatus: mediaAsset.processingStatus,
    caption: input.caption || null,
    durationMs:
      input.storedAsset.assetKind === "video"
        ? (input.storedAsset.durationMs ?? 10_000)
        : null,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    status: nextStoryStatus,
    moderationStatus: initialModerationStatus,
    moderationReason: moderation?.reason ?? null,
    brandSignalScore: brandSignalScore.toFixed(2),
    createdAt: input.createdAt ?? now,
  })

  if (moderation) {
    await recordModerationCheck({
      targetKind: "story",
      targetId: storyId,
      actorUserId: input.session.id,
      mediaAssetId: mediaAsset.id,
      result: moderation,
    }).catch(() => undefined)
  }

  if (mergedMentions.length > 0) {
    await db.insert(storyMentions).values(
      mergedMentions.map((mention) => ({
        id: randomUUID(),
        storyId,
        brandSlug: mention.brandSlug,
        mentionType: mention.mentionType,
        confidence: mention.mentionType === "tag" ? "1.00" : "0.72",
      })),
    )
  }

  if (elements.length > 0) {
    await db.insert(storyElements).values(
      elements.map((element) => ({
        id: randomUUID(),
        storyId,
        kind: element.kind,
        label: element.label,
        href: element.href ?? null,
        sourceInteractionId: element.sourceInteractionId ?? null,
        sourceActorName: element.sourceActorName ?? null,
        sourceActorHandle: element.sourceActorHandle ?? null,
        sourceActorAvatarUrl: element.sourceActorAvatarUrl ?? null,
        positionX: element.positionX ?? "50.00",
        positionY: element.positionY ?? "74.00",
      })),
    )
  }

  if (!moderation) {
    await enqueueStoryModeration(storyId).catch((error) => {
      console.error("story_moderation_dispatch_deferred", { storyId, error })
    })
  }

  if (
    input.storedAsset.assetKind === "video" &&
    input.storedAsset.storageProvider === "vercel-blob" &&
    input.storedAsset.processingStatus === "processing" &&
    input.storedAsset.originalStorageKey?.startsWith("media-originals/")
  ) {
    await enqueueMediaProcessing(mediaAsset.id).catch((error) => {
      console.error("media_processing_enqueue_failed", {
        storyId,
        mediaAssetId: mediaAsset.id,
        error,
      })
    })
  }

  if (nextStoryStatus === "live") {
    await enqueueStoryPublication(storyId).catch((error) => {
      console.error("story_publication_enqueue_failed", { storyId, error })
    })
  } else {
    await invalidateMobileFeedSnapshotsForCreator(input.session.id).catch(
      () => undefined,
    )
  }

  return storyId
}

export async function getStoryByStoredAssetForOwner(input: {
  ownerId: string
  storageProvider: string
  storageKey: string
}): Promise<StoredAssetStory | null> {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      assetKind: stories.assetKind,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      placeholderUrl: stories.placeholderUrl,
      storageProvider: stories.storageProvider,
      storageKey: stories.storageKey,
      contentType: stories.contentType,
      byteSize: stories.byteSize,
      checksum: stories.checksum,
      width: stories.width,
      height: stories.height,
      durationMs: stories.durationMs,
      originalMediaUrl: stories.originalMediaUrl,
      originalThumbnailUrl: stories.originalThumbnailUrl,
      originalStorageProvider: stories.originalStorageProvider,
      originalStorageKey: stories.originalStorageKey,
      originalContentType: stories.originalContentType,
      originalByteSize: stories.originalByteSize,
      originalChecksum: stories.originalChecksum,
      originalWidth: stories.originalWidth,
      originalHeight: stories.originalHeight,
      originalDurationMs: stories.originalDurationMs,
      processingStatus: stories.processingStatus,
    })
    .from(stories)
    .where(
      and(
        eq(stories.creatorId, input.ownerId),
        eq(stories.assetKind, "video"),
        eq(stories.storageProvider, input.storageProvider),
        eq(stories.storageKey, input.storageKey),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(1)

  return story ?? null
}

export async function attachOriginalStoryRenditionForOwner(input: {
  ownerId: string
  storyId: string
  storedAsset: StoredStoryAsset
}) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      assetKind: stories.assetKind,
      mediaAssetId: stories.mediaAssetId,
      originalStorageProvider: stories.originalStorageProvider,
      originalStorageKey: stories.originalStorageKey,
    })
    .from(stories)
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.creatorId, input.ownerId),
        eq(stories.assetKind, "video"),
      ),
    )
    .limit(1)

  if (!story) {
    throw new StoryUploadError("Story not found.")
  }

  if (
    story.originalStorageProvider === input.storedAsset.storageProvider &&
    story.originalStorageKey === input.storedAsset.storageKey
  ) {
    return { storyId: story.id, alreadyAttached: true }
  }

  const originalFields = {
    originalMediaUrl:
      input.storedAsset.originalMediaUrl ?? input.storedAsset.mediaUrl,
    originalThumbnailUrl:
      input.storedAsset.originalThumbnailUrl ?? input.storedAsset.thumbnailUrl,
    originalStorageProvider:
      input.storedAsset.originalStorageProvider ?? input.storedAsset.storageProvider,
    originalStorageKey:
      input.storedAsset.originalStorageKey ?? input.storedAsset.storageKey,
    originalContentType:
      input.storedAsset.originalContentType ?? input.storedAsset.contentType,
    originalByteSize:
      input.storedAsset.originalByteSize ?? input.storedAsset.byteSize,
    originalChecksum:
      input.storedAsset.originalChecksum ?? input.storedAsset.checksum,
    originalWidth: input.storedAsset.originalWidth ?? input.storedAsset.width,
    originalHeight: input.storedAsset.originalHeight ?? input.storedAsset.height,
    originalDurationMs:
      input.storedAsset.originalDurationMs ?? input.storedAsset.durationMs,
  }

  await db
    .update(stories)
    .set(originalFields)
    .where(eq(stories.id, story.id))

  await db
    .update(mediaAssets)
    .set({
      ...originalFields,
      updatedAt: new Date(),
    })
    .where(eq(mediaAssets.id, story.mediaAssetId))

  await invalidateMobileFeedSnapshotsForCreator(input.ownerId).catch(
    () => undefined,
  )

  return { storyId: story.id, alreadyAttached: false }
}

export async function setStoryThumbnail(storyId: string, thumbnailUrl: string | null) {
  await getDb()
    .update(stories)
    .set({ thumbnailUrl, placeholderUrl: thumbnailUrl })
    .where(eq(stories.id, storyId))
}

export async function updateStoryForOwner(input: UpdateStoryInput) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
      status: stories.status,
      processingStatus: stories.processingStatus,
      moderationStatus: stories.moderationStatus,
    })
    .from(stories)
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.creatorId, input.ownerId),
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!story) {
    throw new Error("Story not found or no longer editable.")
  }

  const elements = await resolveStoryElementsForOwner({
    ownerId: input.ownerId,
    elements: input.elements,
  })
  const textMentions = extractCaptionMentions(input.caption)
  const mergedMentions = [
    ...input.explicitBrandTags.map((brandSlug) => ({
      brandSlug,
      mentionType: "tag" as const,
    })),
    ...textMentions
      .filter((brandSlug) => !input.explicitBrandTags.includes(brandSlug))
      .map((brandSlug) => ({
        brandSlug,
        mentionType: "text" as const,
      })),
  ]
  const brandSignalScore = Math.min(
    100,
    mergedMentions.reduce(
      (score, mention) => score + (mention.mentionType === "tag" ? 35 : 18),
      0,
    ),
  )
  const moderation = await moderateUserContent({
    textParts: storyModerationTextParts({ ...input, elements }),
    linkUrls: storyModerationLinkUrls(elements),
  })
  const isApproved = moderation.action === "approve"

  await reverseUnpaidStoryEarnings(story.id)

  const updatedStories = await db
    .update(stories)
    .set({
      caption: input.caption || null,
      status: moderation.action === "reject" ? "removed" : isApproved ? "live" : "processing",
      moderationStatus: moderationStatusFromResult(moderation),
      moderationReason: moderation.reason,
      reviewedAt: null,
      reviewedByUserId: null,
      brandSignalScore: brandSignalScore.toFixed(2),
    })
    .where(
      and(
        eq(stories.id, input.storyId),
        eq(stories.creatorId, input.ownerId),
        eq(stories.status, story.status),
        eq(stories.processingStatus, story.processingStatus),
        eq(stories.moderationStatus, story.moderationStatus),
        gt(stories.expiresAt, new Date()),
      ),
    )
    .returning({ id: stories.id })

  if (updatedStories.length === 0) {
    throw new Error("Story changed while it was being reviewed. Try again.")
  }

  await recordModerationCheck({
    targetKind: "story",
    targetId: input.storyId,
    actorUserId: input.ownerId,
    result: moderation,
  }).catch(() => undefined)

  await db.delete(storyMentions).where(eq(storyMentions.storyId, input.storyId))
  await db.delete(storyElements).where(eq(storyElements.storyId, input.storyId))

  if (mergedMentions.length > 0) {
    await db.insert(storyMentions).values(
      mergedMentions.map((mention) => ({
        id: randomUUID(),
        storyId: input.storyId,
        brandSlug: mention.brandSlug,
        mentionType: mention.mentionType,
        confidence: mention.mentionType === "tag" ? "1.00" : "0.72",
      })),
    )
  }

  if (elements.length > 0) {
    await db.insert(storyElements).values(
      elements.map((element) => ({
        id: randomUUID(),
        storyId: input.storyId,
        kind: element.kind,
        label: element.label,
        href: element.href ?? null,
        sourceInteractionId: element.sourceInteractionId ?? null,
        sourceActorName: element.sourceActorName ?? null,
        sourceActorHandle: element.sourceActorHandle ?? null,
        sourceActorAvatarUrl: element.sourceActorAvatarUrl ?? null,
        positionX: element.positionX ?? "50.00",
        positionY: element.positionY ?? "74.00",
      })),
    )
  }

  if (isApproved) {
    await enqueueStoryPublication(input.storyId).catch((error) => {
      console.error("story_publication_enqueue_failed", {
        storyId: input.storyId,
        error,
      })
    })
  }

  await invalidateMobileFeedSnapshotsForCreator(input.ownerId).catch(
    () => undefined,
  )
}

export async function removeStoryForOwner(storyId: string, ownerId: string) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      mediaUrl: stories.mediaUrl,
      thumbnailUrl: stories.thumbnailUrl,
      placeholderUrl: stories.placeholderUrl,
      originalMediaUrl: stories.originalMediaUrl,
      originalThumbnailUrl: stories.originalThumbnailUrl,
    })
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.creatorId, ownerId)))
    .limit(1)

  if (!story) {
    throw new Error("Story not found.")
  }

  await db
    .update(stories)
    .set({
      status: "removed",
    })
    .where(and(eq(stories.id, storyId), eq(stories.creatorId, ownerId)))

  await Promise.allSettled([
    reverseUnpaidStoryEarnings(story.id),
    invalidateMobileFeedSnapshotsForCreator(ownerId),
  ])

  return {
    mediaUrl: story.mediaUrl,
    thumbnailUrl: story.thumbnailUrl,
    placeholderUrl: story.placeholderUrl,
    originalMediaUrl: story.originalMediaUrl,
    originalThumbnailUrl: story.originalThumbnailUrl,
  }
}
