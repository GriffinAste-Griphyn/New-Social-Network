import { randomUUID } from "node:crypto"

import {
  asc,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
} from "drizzle-orm"
import type { SocialStoryCard } from "@ubeye/shared"

import type { CompleteAuthSession } from "@/lib/auth"
import {
  processStoryCreatorEarnings,
  reverseUnpaidStoryEarnings,
} from "@/lib/creator-earnings"
import { notifyCreatorStoryPosted } from "@/lib/creator-notifications"
import { getDb } from "@/lib/db"
import { createMediaAssetFromStoredStoryAsset } from "@/lib/media-assets"
import { evaluateStoryModeration } from "@/lib/moderation"
import {
  creatorProfiles,
  creatorScores,
  stories,
  storyElements,
  storyMentions,
  users,
} from "@/lib/db/schema"
import { listFollowingProfiles } from "@/lib/follow-store"
import { formatStoryPostedAt } from "@/lib/story-time"
import { publicStoryMediaUrl, type StoredStoryAsset } from "@/lib/story-storage"
import { refreshProcessingCloudflareStories } from "@/lib/stories/cloudflare-status"
import { getBlockedPeerIds, isBlockedBetween } from "@/lib/social-safety"
import {
  extractCaptionMentions,
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
  caption: string | null
  durationMs: number | null
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
  kind: "text" | "sticker" | "link"
  label: string
  href: string | null
  positionX: string | null
  positionY: string | null
}

type RankedStoryRow = FeedStoryRow & {
  feedScore: number
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

export type FeedStoryCard = SocialStoryCard

export type MyStoryElement = {
  id: string
  kind: "text" | "sticker" | "link"
  label: string
  href: string | null
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
  title: string
  postedAt: string
  durationSeconds?: number
  captionVerticalPercent?: number
  textOverlays: Array<{
    id: string
    label: string
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

type CreateStoryInput = {
  session: CompleteAuthSession
  caption: string
  explicitBrandTags: string[]
  elements: StoryElementInput[]
  storedAsset: StoredStoryAsset
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

function textOverlaysFromElements(elements: StoryElementRecord[]) {
  return elements
    .filter((element) => element.kind === "text")
    .map((element) => ({
      id: element.id,
      label: element.label,
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
    title:
      firstTextOverlay?.label.trim() ||
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

function orderStoriesNewestFirst<T extends { createdAt: Date }>(rows: T[]) {
  return [...rows].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
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
        label: element.label,
        href: element.href,
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
    latestThumbnailUrl: latest
      ? latest.assetKind === "image"
        ? latest.mediaUrl
        : latest.thumbnailUrl
      : null,
    latestAssetKind: latest?.assetKind ?? null,
    expiresSoonLabel:
      shortestWindow === null ? null : formatExpiresSoonLabel(shortestWindow),
    items,
  }
}

async function getLiveStoryRows() {
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
      caption: stories.caption,
      durationMs: stories.durationMs,
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
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(24)

  return rows.flatMap((row) => {
    const story = toCompleteStoryRow(row)

    return story ? [story] : []
  })
}

async function getLiveStoryRowsForCreator(creatorId: string) {
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
      caption: stories.caption,
      durationMs: stories.durationMs,
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
        eq(stories.status, "live"),
        eq(stories.moderationStatus, "approved"),
        gt(stories.expiresAt, new Date()),
        isNotNull(users.displayName),
        isNotNull(users.handle),
      ),
    )
    .orderBy(desc(stories.createdAt))
    .limit(24)

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
      positionX: storyElements.positionX,
      positionY: storyElements.positionY,
    })
    .from(storyElements)
    .where(inArray(storyElements.storyId, storyIds))
    .orderBy(asc(storyElements.createdAt))
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

export async function getMyStoryStack(viewerId: string): Promise<MyStorySummary> {
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

  await refreshProcessingCloudflareStories({ creatorId: viewerId })

  const rows = (await getLiveStoryRowsForCreator(viewerId)).filter(
    (story) => story.id !== MY_STORY_ROUTE_ID,
  )
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

export async function getFeedData(viewerId: string): Promise<FeedData> {
  await refreshProcessingCloudflareStories({ limit: 12 })

  const [rawStoryRows, followingProfiles, myStory, blockedPeerIds] = await Promise.all([
    getLiveStoryRows(),
    listFollowingProfiles(viewerId),
    getMyStoryStack(viewerId),
    getBlockedPeerIds(viewerId),
  ])
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
  const [mentionRows, elementRows] = await Promise.all([
    getStoryMentions(storyIds),
    getStoryElements(storyIds),
  ])
  const mentionsByStory = groupMentions(mentionRows)
  const elementsByStory = groupElements(elementRows)

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
  const followingTimelineRows = orderStoriesNewestFirst(
    storyRows.filter((story) => followedCreatorIds.has(story.creatorId)),
  )
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

  const followingStories = firstStoryPerCreator(followingRankedStories)
    .slice(0, 8)
    .map((story) =>
      buildFeedStoryCard(
        story,
        mentionsByStory.get(story.id) ?? [],
        elementsByStory.get(story.id) ?? [],
        followingTimelineSegmentCountByCreator.get(story.creatorId) ?? 1,
      ),
    )
  const followingTimelineStories = followingTimelineRows.slice(0, 24).map((story) =>
    buildFeedStoryCard(
      story,
      mentionsByStory.get(story.id) ?? [],
      elementsByStory.get(story.id) ?? [],
      followingTimelineSegmentCountByCreator.get(story.creatorId) ?? 1,
    ),
  )

  const discoverStories = firstStoryPerCreator(discoverRankedStories)
    .slice(0, 8)
    .map((story) => latestDiscoverStoryByCreator.get(story.creatorId) ?? story)
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
  const moderation = evaluateStoryModeration({
    caption: input.caption,
    explicitBrandTags: input.explicitBrandTags,
    elements: input.elements,
  })
  const mediaAsset = await createMediaAssetFromStoredStoryAsset({
    ownerUserId: input.session.id,
    purpose: "story",
    storedAsset: input.storedAsset,
  })
  const mediaModerationReason =
    mediaAsset.scanStatus === "flagged" || mediaAsset.scanStatus === "failed"
      ? mediaAsset.scanReason ?? "Media upload was flagged by safety scanning."
      : null
  const isApproved = moderation.status === "approved" && !mediaModerationReason
  const isMediaReady = mediaAsset.processingStatus === "ready"

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
    storageProvider: input.storedAsset.storageProvider,
    storageKey: input.storedAsset.storageKey,
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
    status: isApproved && isMediaReady ? "live" : "processing",
    moderationStatus: mediaModerationReason ? "flagged" : moderation.status,
    moderationReason: mediaModerationReason ?? moderation.reason,
    brandSignalScore: brandSignalScore.toFixed(2),
  })

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

  if (input.elements.length > 0) {
    await db.insert(storyElements).values(
      input.elements.map((element) => ({
        id: randomUUID(),
        storyId,
        kind: element.kind,
        label: element.label,
        href: element.href ?? null,
        positionX: element.positionX ?? "50.00",
        positionY: element.positionY ?? "74.00",
      })),
    )
  }

  if (isApproved && isMediaReady) {
    await processStoryCreatorEarnings(storyId)
    await notifyCreatorStoryPosted({
      creatorId: input.session.id,
      creatorName: input.session.displayName,
      storyId,
      caption: input.caption || null,
    }).catch(() => undefined)
  }

  return storyId
}

export async function updateStoryForOwner(input: UpdateStoryInput) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      creatorId: stories.creatorId,
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
  const moderation = evaluateStoryModeration({
    caption: input.caption,
    explicitBrandTags: input.explicitBrandTags,
    elements: input.elements,
  })
  const isApproved = moderation.status === "approved"

  await reverseUnpaidStoryEarnings(story.id)

  await db
    .update(stories)
    .set({
      caption: input.caption || null,
      status: isApproved ? "live" : "processing",
      moderationStatus: moderation.status,
      moderationReason: moderation.reason,
      reviewedAt: null,
      reviewedByUserId: null,
      brandSignalScore: brandSignalScore.toFixed(2),
    })
    .where(eq(stories.id, input.storyId))

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

  if (input.elements.length > 0) {
    await db.insert(storyElements).values(
      input.elements.map((element) => ({
        id: randomUUID(),
        storyId: input.storyId,
        kind: element.kind,
        label: element.label,
        href: element.href ?? null,
        positionX: element.positionX ?? "50.00",
        positionY: element.positionY ?? "74.00",
      })),
    )
  }

  if (isApproved) {
    await processStoryCreatorEarnings(input.storyId)
  }
}

export async function removeStoryForOwner(storyId: string, ownerId: string) {
  const db = getDb()
  const [story] = await db
    .select({
      id: stories.id,
      mediaUrl: stories.mediaUrl,
    })
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.creatorId, ownerId)))
    .limit(1)

  if (!story) {
    throw new Error("Story not found.")
  }

  await reverseUnpaidStoryEarnings(story.id)

  await db
    .update(stories)
    .set({
      status: "removed",
    })
    .where(and(eq(stories.id, storyId), eq(stories.creatorId, ownerId)))

  return story.mediaUrl
}
