"use client"

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { Compass, Flag, LogOut, MoreHorizontal, PanelLeftIcon, Plus, Search, User, Users, X } from "lucide-react"
import { useProductAuthShellContext } from "@/components/product-auth-shell"
import ProductSwitcher from "@/components/product-switcher"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { readCreativeVideoDurationSeconds } from "@/lib/creative-video-duration"
import { SOCIAL_REPORT_REASON_OPTIONS, type SocialReportReason } from "@/lib/moderation"

type RelationshipState = {
  isFollowing: boolean
  isMuted: boolean
  isBlocked: boolean
  hasBlockedYou: boolean
}

type RelationshipAction = "follow" | "unfollow" | "mute" | "unmute" | "block" | "unblock"

type StoryProcessingStatus = "READY" | "PENDING" | "PROCESSING" | "FAILED"

type StoryItem = {
  id: string
  kind: "image" | "video"
  url: string
  thumbnailUrl: string | null
  storyGroupId?: string | null
  segmentIndex?: number
  clipStartSeconds?: number | null
  clipDurationSeconds?: number | null
  label: string
  processingStatus: StoryProcessingStatus
  processingError: string | null
  createdAt: string
  seen: boolean
}

type StoryDeleteScope = "frame" | "upload"

type StoryUser = {
  id: string
  handle: string
  name: string
  relationship: RelationshipState
  hasUnseen: boolean
  items: StoryItem[]
}

type DirectoryPreviewItem = {
  id: string
  kind: "image"
  url: string
  thumbnailUrl: string | null
  label: string
  createdAt: string
  seen: boolean
}

type DirectoryPerson = {
  id: string
  handle: string
  name: string
  hasStory: boolean
  relationship: RelationshipState
  previewItem: DirectoryPreviewItem | null
}

type SimpleSocialAppProps = {
  displayHandle: string
  setupCtaHref: string
  setupCtaLabel: string
  profileHref: string
  viewerUserId: string
  adNetworkHref: string
}

type StoriesResponseBody = {
  users?: StoryUser[]
  error?: string
}

type PeopleResponseBody = {
  people?: DirectoryPerson[]
  pageInfo?: {
    nextCursor?: string | null
    hasMore?: boolean
  }
  error?: string
}

const IMAGE_STORY_FRAME_MS = 5000
const MAX_VIDEO_STORY_FRAME_SECONDS = 60
const MAX_VIDEO_STORY_FRAMES_PER_UPLOAD = 10
const FOR_YOU_BATCH_SIZE = 24
const DIRECTORY_SEARCH_BATCH_SIZE = 30
const FOLLOWING_PATH = "/social-network/following"
const SIDEBAR_COLLAPSE_STORAGE_KEY = "ubeye_social_sidebar_collapsed"
const SIDEBAR_EXPANDED_WIDTH_CLASS = "md:grid-cols-[280px_1fr]"
const SIDEBAR_COLLAPSED_WIDTH_CLASS = "md:grid-cols-[64px_1fr]"

function initialsFor(handle: string) {
  const cleaned = handle.replace(/[^a-z0-9]/gi, "").trim()
  if (!cleaned) return "?"
  return cleaned.slice(0, 2).toUpperCase()
}

function normalizeRelationship(input: unknown): RelationshipState {
  const value = (input || {}) as Partial<RelationshipState>
  return {
    isFollowing: value.isFollowing === true,
    isMuted: value.isMuted === true,
    isBlocked: value.isBlocked === true,
    hasBlockedYou: value.hasBlockedYou === true,
  }
}

function normalizeProcessingStatus(value: unknown): StoryProcessingStatus {
  if (value === "READY" || value === "PENDING" || value === "PROCESSING" || value === "FAILED") {
    return value
  }
  return "READY"
}

function normalizeDirectoryPerson(input: unknown): DirectoryPerson | null {
  if (!input || typeof input !== "object") return null
  const candidate = input as Partial<DirectoryPerson> & {
    previewItem?: Partial<DirectoryPreviewItem> | null
  }
  if (typeof candidate.id !== "string") return null

  const previewCandidate = candidate.previewItem
  const previewItem =
    previewCandidate &&
    typeof previewCandidate.id === "string" &&
    typeof previewCandidate.url === "string" &&
    typeof previewCandidate.label === "string" &&
    typeof previewCandidate.createdAt === "string"
      ? {
          id: previewCandidate.id,
          kind: "image" as const,
          url: previewCandidate.url,
          thumbnailUrl: typeof previewCandidate.thumbnailUrl === "string" ? previewCandidate.thumbnailUrl : null,
          label: previewCandidate.label,
          createdAt: previewCandidate.createdAt,
          seen: previewCandidate.seen === true,
        }
      : null

  return {
    id: candidate.id,
    handle: typeof candidate.handle === "string" ? candidate.handle : "user",
    name: typeof candidate.name === "string" ? candidate.name : "User",
    hasStory: candidate.hasStory === true,
    relationship: normalizeRelationship(candidate.relationship),
    previewItem,
  }
}

function applyRelationshipAction(current: RelationshipState, action: RelationshipAction): RelationshipState {
  if (action === "follow") {
    if (current.isFollowing) return current
    return { ...current, isFollowing: true }
  }

  if (action === "unfollow") {
    if (!current.isFollowing) return current
    return { ...current, isFollowing: false }
  }

  if (action === "mute") {
    if (current.isMuted) return current
    return { ...current, isMuted: true }
  }

  if (action === "unmute") {
    if (!current.isMuted) return current
    return { ...current, isMuted: false }
  }

  if (action === "block") {
    if (current.isBlocked && !current.isFollowing && current.isMuted) return current
    return {
      ...current,
      isBlocked: true,
      isFollowing: false,
      isMuted: true,
    }
  }

  if (!current.isBlocked) return current
  return { ...current, isBlocked: false }
}

function shouldShowInForYou(person: { id: string; relationship: RelationshipState }, viewerUserId: string) {
  if (person.id === viewerUserId) return false
  if (person.relationship.isFollowing) return false
  if (person.relationship.isMuted) return false
  if (person.relationship.isBlocked) return false
  if (person.relationship.hasBlockedYou) return false
  return true
}

function applyRelationshipToCollection<T extends { id: string; relationship: RelationshipState }>(
  rows: T[],
  targetUserId: string,
  action: RelationshipAction,
) {
  let changed = false
  const next = rows.map((row) => {
    if (row.id !== targetUserId) return row
    const nextRelationship = applyRelationshipAction(row.relationship, action)
    if (nextRelationship === row.relationship) return row
    changed = true
    return { ...row, relationship: nextRelationship }
  })
  return changed ? next : rows
}

function buildVideoStorySegments(totalDurationSeconds: number, label: string) {
  const safeDuration = Math.max(1, Math.trunc(totalDurationSeconds))
  const segments: Array<{ label: string; clipStartSeconds: number; clipDurationSeconds: number }> = []
  for (let start = 0; start < safeDuration; start += MAX_VIDEO_STORY_FRAME_SECONDS) {
    const remaining = safeDuration - start
    const clipDurationSeconds = Math.min(MAX_VIDEO_STORY_FRAME_SECONDS, remaining)
    segments.push({
      label,
      clipStartSeconds: start,
      clipDurationSeconds,
    })
  }
  return segments
}

export default function SimpleSocialApp({
  displayHandle,
  setupCtaHref,
  setupCtaLabel,
  profileHref,
  viewerUserId,
  adNetworkHref,
}: SimpleSocialAppProps) {
  const router = useRouter()
  const authShell = useProductAuthShellContext()
  const [search, setSearch] = useState("")
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([])
  const [directoryPeople, setDirectoryPeople] = useState<DirectoryPerson[]>([])
  const [forYouTiles, setForYouTiles] = useState<DirectoryPerson[]>([])
  const [forYouNextCursor, setForYouNextCursor] = useState<string | null>(null)
  const [forYouHasMore, setForYouHasMore] = useState(false)
  const [loadingForYou, setLoadingForYou] = useState(true)
  const [loadingForYouMore, setLoadingForYouMore] = useState(false)
  const [forYouError, setForYouError] = useState<string | null>(null)
  const [directoryNextCursor, setDirectoryNextCursor] = useState<string | null>(null)
  const [directoryHasMore, setDirectoryHasMore] = useState(false)
  const [loadingDirectoryPeople, setLoadingDirectoryPeople] = useState(false)
  const [directoryError, setDirectoryError] = useState<string | null>(null)
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loadingStories, setLoadingStories] = useState(true)
  const [storiesError, setStoriesError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadInfo, setUploadInfo] = useState<string | null>(null)
  const [relationshipError, setRelationshipError] = useState<string | null>(null)
  const [relationshipBusyUserId, setRelationshipBusyUserId] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportSuccess, setReportSuccess] = useState<string | null>(null)
  const [reportingStoryId, setReportingStoryId] = useState<string | null>(null)
  const [storyDeleteError, setStoryDeleteError] = useState<string | null>(null)
  const [deletingStoryId, setDeletingStoryId] = useState<string | null>(null)
  const [deletingStoryScope, setDeletingStoryScope] = useState<StoryDeleteScope | null>(null)
  const [storyProgress, setStoryProgress] = useState(0)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const forYouLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const directoryLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const relationshipInFlightRef = useRef<Set<string>>(new Set())
  const advancedStoryItemIdRef = useRef<string | null>(null)
  const resolvedAdNetworkHref = authShell?.adNetworkHref || adNetworkHref
  const resolvedProfileHref = profileHref
  const userEmail = authShell?.userEmail || null
  const showSetupMenuItem = setupCtaHref !== resolvedProfileHref || setupCtaLabel !== "Profile"

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)
    setIsSidebarCollapsed(saved === "1")
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, isSidebarCollapsed ? "1" : "0")
  }, [isSidebarCollapsed])

  const profileInitial = useMemo(() => {
    const email = (userEmail || "").trim()
    if (email) {
      const first = email.split("@")[0]?.[0] || email[0]
      return (first || "?").toUpperCase()
    }
    return initialsFor(displayHandle).slice(0, 1)
  }, [displayHandle, userEmail])

  const parsePeopleResponse = useCallback((body: PeopleResponseBody | null) => {
    const rows = Array.isArray(body?.people) ? body.people : []
    const people = rows
      .map((candidate) => normalizeDirectoryPerson(candidate))
      .filter((candidate): candidate is DirectoryPerson => Boolean(candidate))
    const nextCursor = typeof body?.pageInfo?.nextCursor === "string" ? body.pageInfo.nextCursor : null
    const hasMore = body?.pageInfo?.hasMore === true
    return { people, nextCursor, hasMore }
  }, [])

  const loadStories = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setLoadingStories(true)
    }
    setStoriesError(null)

    try {
      const response = await fetch("/api/social-network/stories?includePeople=false", { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as StoriesResponseBody | null

      if (!response.ok) {
        const fallback = `Could not load stories (HTTP ${response.status}).`
        throw new Error(body?.error || fallback)
      }

      const users = Array.isArray(body?.users)
        ? body.users
            .filter((candidate): candidate is StoryUser => {
              return Boolean(candidate && typeof candidate.id === "string" && Array.isArray(candidate.items))
            })
            .map((user) => ({
              id: user.id,
              handle: typeof user.handle === "string" ? user.handle : "user",
              name: typeof user.name === "string" ? user.name : "User",
              relationship: normalizeRelationship(user.relationship),
              hasUnseen: user.hasUnseen === true,
              items: user.items
                .filter((item): item is StoryItem => {
                  return (
                    Boolean(item) &&
                    typeof item.id === "string" &&
                    typeof item.url === "string" &&
                    typeof item.label === "string" &&
                    typeof item.createdAt === "string" &&
                    (item.kind === "image" || item.kind === "video")
                  )
                })
                .map((item) => ({
                  ...item,
                  thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
                  storyGroupId: typeof item.storyGroupId === "string" ? item.storyGroupId : null,
                  segmentIndex: Number.isFinite(Number(item.segmentIndex))
                    ? Math.max(0, Math.trunc(Number(item.segmentIndex)))
                    : 0,
                  clipStartSeconds:
                    item.clipStartSeconds === null || item.clipStartSeconds === undefined
                      ? null
                      : Number.isFinite(Number(item.clipStartSeconds)) && Number(item.clipStartSeconds) >= 0
                        ? Math.trunc(Number(item.clipStartSeconds))
                        : null,
                  clipDurationSeconds:
                    item.clipDurationSeconds === null || item.clipDurationSeconds === undefined
                      ? null
                      : Number.isFinite(Number(item.clipDurationSeconds)) && Number(item.clipDurationSeconds) > 0
                        ? Math.trunc(Number(item.clipDurationSeconds))
                        : null,
                  processingStatus: normalizeProcessingStatus(item.processingStatus),
                  processingError: typeof item.processingError === "string" ? item.processingError : null,
                  seen: item.seen === true,
                })),
            }))
        : []

      setStoryUsers(users)
    } catch (error) {
      setStoriesError(error instanceof Error ? error.message : "Could not load stories.")
    } finally {
      if (showLoadingState) {
        setLoadingStories(false)
      }
    }
  }, [])

  const loadForYouPage = useCallback(
    async ({ cursor, append }: { cursor: string | null; append: boolean }) => {
      if (append) {
        setLoadingForYouMore(true)
      } else {
        setLoadingForYou(true)
      }
      if (!append) {
        setForYouError(null)
      }

      try {
        const query = new URLSearchParams({
          scope: "for-you",
          limit: String(FOR_YOU_BATCH_SIZE),
        })
        if (cursor) {
          query.set("cursor", cursor)
        }
        const response = await fetch(`/api/social-network/people?${query.toString()}`, { cache: "no-store" })
        const body = (await response.json().catch(() => null)) as PeopleResponseBody | null
        if (!response.ok) {
          const fallback = `Could not load For You (HTTP ${response.status}).`
          throw new Error(body?.error || fallback)
        }

        const page = parsePeopleResponse(body)
        setForYouTiles((previous) => {
          if (!append) return page.people
          if (page.people.length === 0) return previous
          const map = new Map(previous.map((row) => [row.id, row]))
          for (const person of page.people) {
            map.set(person.id, person)
          }
          return Array.from(map.values())
        })
        setForYouNextCursor(page.nextCursor)
        setForYouHasMore(page.hasMore)
      } catch (error) {
        setForYouError(error instanceof Error ? error.message : "Could not load For You.")
      } finally {
        if (append) {
          setLoadingForYouMore(false)
        } else {
          setLoadingForYou(false)
        }
      }
    },
    [parsePeopleResponse],
  )

  const loadDirectoryPage = useCallback(
    async ({
      query,
      cursor,
      append,
    }: {
      query: string
      cursor: string | null
      append: boolean
    }) => {
      if (!query.trim()) return
      setLoadingDirectoryPeople(true)
      if (!append) {
        setDirectoryError(null)
      }

      try {
        const searchParams = new URLSearchParams({
          scope: "directory",
          limit: String(DIRECTORY_SEARCH_BATCH_SIZE),
          query,
        })
        if (cursor) {
          searchParams.set("cursor", cursor)
        }
        const response = await fetch(`/api/social-network/people?${searchParams.toString()}`, { cache: "no-store" })
        const body = (await response.json().catch(() => null)) as PeopleResponseBody | null
        if (!response.ok) {
          const fallback = `Could not search people (HTTP ${response.status}).`
          throw new Error(body?.error || fallback)
        }

        const page = parsePeopleResponse(body)
        setDirectoryPeople((previous) => {
          if (!append) return page.people
          if (page.people.length === 0) return previous
          const map = new Map(previous.map((row) => [row.id, row]))
          for (const person of page.people) {
            map.set(person.id, person)
          }
          return Array.from(map.values())
        })
        setDirectoryNextCursor(page.nextCursor)
        setDirectoryHasMore(page.hasMore)
      } catch (error) {
        setDirectoryError(error instanceof Error ? error.message : "Could not search people.")
      } finally {
        setLoadingDirectoryPeople(false)
      }
    },
    [parsePeopleResponse],
  )

  useEffect(() => {
    void loadStories()
  }, [loadStories])

  useEffect(() => {
    void loadForYouPage({ cursor: null, append: false })
  }, [loadForYouPage])

  const searchQuery = search.trim()

  useEffect(() => {
    if (!searchQuery) {
      setDirectoryPeople([])
      setDirectoryNextCursor(null)
      setDirectoryHasMore(false)
      setDirectoryError(null)
      return
    }

    const timer = window.setTimeout(() => {
      void loadDirectoryPage({ query: searchQuery, cursor: null, append: false })
    }, 180)
    return () => {
      window.clearTimeout(timer)
    }
  }, [loadDirectoryPage, searchQuery])

  const viewerStoryUser = useMemo(() => {
    return storyUsers.find((user) => user.id === viewerUserId) || null
  }, [storyUsers, viewerUserId])

  const storiesRowUsers = useMemo(() => {
    return storyUsers.filter((user) => user.id !== viewerUserId && user.relationship.isFollowing)
  }, [storyUsers, viewerUserId])

  const searchResults = useMemo(() => {
    if (!searchQuery) return []
    return directoryPeople
  }, [directoryPeople, searchQuery])

  const activeUser = useMemo(() => {
    if (!activeUserId) return null
    return storyUsers.find((user) => user.id === activeUserId) || null
  }, [activeUserId, storyUsers])

  const activeUserPosition = useMemo(() => {
    if (!activeUserId) return -1
    return storyUsers.findIndex((user) => user.id === activeUserId)
  }, [activeUserId, storyUsers])

  const activeItem = activeUser?.items[activeIndex] || null
  const activeItemId = activeItem?.id ?? null
  const activeItemKind = activeItem?.kind ?? null
  const activeClipStartSeconds =
    activeItem?.clipStartSeconds === null || activeItem?.clipStartSeconds === undefined
      ? 0
      : Math.max(0, activeItem.clipStartSeconds)
  const activeClipDurationSeconds =
    activeItem?.clipDurationSeconds === null || activeItem?.clipDurationSeconds === undefined
      ? null
      : Math.max(1, activeItem.clipDurationSeconds)
  const viewerHasStory = Boolean(viewerStoryUser && viewerStoryUser.items.length > 0)
  const viewerStoryHandle = viewerStoryUser?.handle || displayHandle
  const isViewingOwnStory = activeUser?.id === viewerUserId
  const activeStoryGroupId = activeItem?.storyGroupId || null
  const activeStoryGroupFrameCount = useMemo(() => {
    if (!activeUser || !activeStoryGroupId) return 0
    return activeUser.items.filter((item) => item.storyGroupId === activeStoryGroupId).length
  }, [activeStoryGroupId, activeUser])
  const canDeleteEntireUpload = isViewingOwnStory && Boolean(activeStoryGroupId) && activeStoryGroupFrameCount > 1

  useEffect(() => {
    if (!forYouHasMore || !forYouNextCursor || loadingForYou || loadingForYouMore) return
    const loadMoreTarget = forYouLoadMoreRef.current
    if (!loadMoreTarget) return

    let locked = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (locked) return
        locked = true
        void loadForYouPage({ cursor: forYouNextCursor, append: true }).finally(() => {
          window.requestAnimationFrame(() => {
            locked = false
          })
        })
      },
      { rootMargin: "320px 0px" },
    )

    observer.observe(loadMoreTarget)
    return () => {
      observer.disconnect()
    }
  }, [forYouHasMore, forYouNextCursor, loadingForYou, loadingForYouMore, loadForYouPage])

  useEffect(() => {
    if (!searchQuery || !directoryHasMore || !directoryNextCursor || loadingDirectoryPeople) return
    const loadMoreTarget = directoryLoadMoreRef.current
    if (!loadMoreTarget) return

    let locked = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (locked) return
        locked = true
        void loadDirectoryPage({ query: searchQuery, cursor: directoryNextCursor, append: true }).finally(() => {
          window.requestAnimationFrame(() => {
            locked = false
          })
        })
      },
      { rootMargin: "280px 0px" },
    )

    observer.observe(loadMoreTarget)
    return () => {
      observer.disconnect()
    }
  }, [directoryHasMore, directoryNextCursor, loadDirectoryPage, loadingDirectoryPeople, searchQuery])

  const openStory = useCallback((userId: string, startIndex = 0) => {
    setActiveUserId(userId)
    setActiveIndex(startIndex)
  }, [])

  const closeStory = useCallback(() => {
    setActiveUserId(null)
    setActiveIndex(0)
    setStoryProgress(0)
    setStoryDeleteError(null)
  }, [])

  const goPrev = useCallback(() => {
    if (!activeUser) return

    if (activeIndex > 0) {
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }

    for (let cursor = activeUserPosition - 1; cursor >= 0; cursor -= 1) {
      const previousUser = storyUsers[cursor]
      if (!previousUser || previousUser.items.length === 0) continue
      setActiveUserId(previousUser.id)
      setActiveIndex(previousUser.items.length - 1)
      return
    }
  }, [activeIndex, activeUser, activeUserPosition, storyUsers])

  const goNext = useCallback(() => {
    if (!activeUser) return

    if (activeIndex < activeUser.items.length - 1) {
      setActiveIndex((current) => Math.min(activeUser.items.length - 1, current + 1))
      return
    }

    for (let cursor = activeUserPosition + 1; cursor < storyUsers.length; cursor += 1) {
      const nextUser = storyUsers[cursor]
      if (!nextUser || nextUser.items.length === 0) continue
      setActiveUserId(nextUser.id)
      setActiveIndex(0)
      return
    }

    closeStory()
  }, [activeIndex, activeUser, activeUserPosition, closeStory, storyUsers])

  const advanceFromActiveVideoSegment = useCallback(() => {
    if (!activeItemId) {
      goNext()
      return
    }
    if (advancedStoryItemIdRef.current === activeItemId) return
    advancedStoryItemIdRef.current = activeItemId
    goNext()
  }, [activeItemId, goNext])

  useEffect(() => {
    advancedStoryItemIdRef.current = null
  }, [activeItemId])

  useEffect(() => {
    if (!activeUserId || !activeItemId) {
      setStoryProgress(0)
      return
    }
    setStoryProgress(0)
    setReportError(null)
    setReportSuccess(null)
    setStoryDeleteError(null)
  }, [activeItemId, activeUserId])

  useEffect(() => {
    if (!activeUserId || !activeItemId || activeItemKind !== "image") return

    let rafId = 0
    const startedAt = performance.now()

    const tick = (now: number) => {
      const nextProgress = Math.min((now - startedAt) / IMAGE_STORY_FRAME_MS, 1)
      setStoryProgress(nextProgress)

      if (nextProgress >= 1) {
        goNext()
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeItemId, activeItemKind, activeUserId, goNext])

  useEffect(() => {
    if (!activeUserId || !activeItemId) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault()
        goNext()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        goPrev()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        closeStory()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [activeItemId, activeUserId, closeStory, goNext, goPrev])

  const markStorySeen = useCallback(async (storyItemId: string) => {
    if (!storyItemId) return

    setStoryUsers((previous) => {
      let changed = false
      const next = previous.map((user) => {
        let userChanged = false
        const nextItems = user.items.map((item) => {
          if (item.id !== storyItemId || item.seen) return item
          userChanged = true
          changed = true
          return { ...item, seen: true }
        })

        if (!userChanged) return user
        return {
          ...user,
          items: nextItems,
          hasUnseen: nextItems.some((item) => item.seen !== true),
        }
      })

      return changed ? next : previous
    })

    await fetch("/api/social-network/stories/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyItemId }),
    }).catch(() => null)
  }, [])

  useEffect(() => {
    if (!activeItemId || !activeUserId) return
    if (activeUserId === viewerUserId) return
    if (activeItem?.seen === true) return
    void markStorySeen(activeItemId)
  }, [activeItem?.seen, activeItemId, activeUserId, markStorySeen, viewerUserId])

  const updateRelationship = useCallback(
    async (targetUserId: string, action: RelationshipAction) => {
      if (!targetUserId || targetUserId === viewerUserId) return
      if (relationshipInFlightRef.current.has(targetUserId)) return

      relationshipInFlightRef.current.add(targetUserId)
      const previousStoryUsers = storyUsers
      const previousDirectoryPeople = directoryPeople
      const previousForYouTiles = forYouTiles

      setRelationshipBusyUserId(targetUserId)
      setRelationshipError(null)
      setStoryUsers((previous) => applyRelationshipToCollection(previous, targetUserId, action))
      setDirectoryPeople((previous) => applyRelationshipToCollection(previous, targetUserId, action))
      setForYouTiles((previous) => {
        const updated = applyRelationshipToCollection(previous, targetUserId, action)
        return updated.filter((person) => shouldShowInForYou(person, viewerUserId))
      })

      const response = await fetch("/api/social-network/relationships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, action }),
      }).catch(() => null)

      if (!response || !response.ok) {
        const body = response ? await response.json().catch(() => null) : null
        setRelationshipError(body?.error || "Could not update relationship.")
        setStoryUsers(previousStoryUsers)
        setDirectoryPeople(previousDirectoryPeople)
        setForYouTiles(previousForYouTiles)
        relationshipInFlightRef.current.delete(targetUserId)
        setRelationshipBusyUserId((current) => (current === targetUserId ? null : current))
        return
      }

      if ((action === "mute" || action === "block") && activeUserId === targetUserId) {
        closeStory()
      }

      relationshipInFlightRef.current.delete(targetUserId)
      setRelationshipBusyUserId((current) => (current === targetUserId ? null : current))
      void loadStories(false)
      if (action === "unfollow" || action === "unmute" || action === "unblock") {
        void loadForYouPage({ cursor: null, append: false })
      }
      if (searchQuery) {
        void loadDirectoryPage({ query: searchQuery, cursor: null, append: false })
      }
    },
    [
      activeUserId,
      closeStory,
      directoryPeople,
      forYouTiles,
      loadDirectoryPage,
      loadForYouPage,
      loadStories,
      searchQuery,
      storyUsers,
      viewerUserId,
    ],
  )

  const submitStoryReport = useCallback(
    async (storyItemId: string, reason: SocialReportReason) => {
      if (!storyItemId || reportingStoryId) return

      setReportingStoryId(storyItemId)
      setReportError(null)
      setReportSuccess(null)

      try {
        const response = await fetch("/api/social-network/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyItemId, reason }),
        })
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          throw new Error(body?.error || "Could not submit report.")
        }
        setReportSuccess("Report submitted. Our moderation team will review this story.")
      } catch (error) {
        setReportError(error instanceof Error ? error.message : "Could not submit report.")
      } finally {
        setReportingStoryId((current) => (current === storyItemId ? null : current))
      }
    },
    [reportingStoryId],
  )

  const deleteOwnStory = useCallback(
    async (scope: StoryDeleteScope) => {
      if (!isViewingOwnStory || !activeItemId) return
      if (deletingStoryId === activeItemId) return

      const confirmMessage =
        scope === "upload"
          ? "Delete this entire upload from your story?"
          : "Delete this story frame?"
      if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
        return
      }

      setStoryDeleteError(null)
      setDeletingStoryId(activeItemId)
      setDeletingStoryScope(scope)

      try {
        const response = await fetch(
          `/api/social-network/stories/${encodeURIComponent(activeItemId)}?scope=${encodeURIComponent(scope)}`,
          {
            method: "DELETE",
          },
        )
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          throw new Error(body?.error || "Could not delete story.")
        }
        closeStory()
        await loadStories(false)
      } catch (error) {
        setStoryDeleteError(error instanceof Error ? error.message : "Could not delete story.")
      } finally {
        setDeletingStoryId((current) => (current === activeItemId ? null : current))
        setDeletingStoryScope(null)
      }
    },
    [activeItemId, closeStory, deletingStoryId, isViewingOwnStory, loadStories],
  )

  const onUploadClick = () => {
    fileInputRef.current?.click()
  }

  const onYourStoryClick = () => {
    if (viewerHasStory) {
      openStory(viewerUserId)
      return
    }
    onUploadClick()
  }

  const handleSignOut = async () => {
    await signOut({ redirect: false })
    router.push("/login")
    router.refresh()
  }

  const onUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    setUploadError(null)
    setUploadInfo(null)

    try {
      for (const file of Array.from(files)) {
        const uploadRes = await fetch("/api/social-network/stories/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name || "story-upload",
            contentType: file.type || "application/octet-stream",
            fileSize: file.size,
          }),
        })

        if (!uploadRes.ok) {
          const body = (await uploadRes.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error || "Could not start upload.")
        }

        const uploadData = (await uploadRes.json()) as {
          uploadUrl: string
          publicUrl: string
          storageUrl?: string
          deliveryUrl?: string
          key?: string
          contentType?: string
          mediaType: "image" | "video"
        }

        let publishSegments:
          | Array<{ label: string; clipStartSeconds: number; clipDurationSeconds: number }>
          | undefined
        if (uploadData.mediaType === "video") {
          const durationSeconds = await readCreativeVideoDurationSeconds(file)
          const frameLabel = file.name || "Story"
          const nextSegments = buildVideoStorySegments(durationSeconds, frameLabel)
          if (nextSegments.length > MAX_VIDEO_STORY_FRAMES_PER_UPLOAD) {
            throw new Error(`Video is too long. Max ${MAX_VIDEO_STORY_FRAMES_PER_UPLOAD} story frames per upload.`)
          }
          publishSegments = nextSegments
          if (nextSegments.length > 1) {
            setUploadInfo(`${frameLabel} will be posted as ${nextSegments.length} story frames.`)
          } else {
            setUploadInfo(`${frameLabel} will be posted as 1 story frame.`)
          }
        }

        const publishUrl =
          (typeof uploadData.deliveryUrl === "string" && uploadData.deliveryUrl) ||
          (typeof uploadData.storageUrl === "string" && uploadData.storageUrl) ||
          uploadData.publicUrl
        let sourceMediaUrl = (typeof uploadData.storageUrl === "string" && uploadData.storageUrl) || uploadData.publicUrl
        const publishMediaType: "image" | "video" = uploadData.mediaType

        const putRes = await fetch(uploadData.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": uploadData.contentType || file.type || "application/octet-stream",
          },
          body: file,
        })

        if (!putRes.ok) {
          const details = await putRes.text().catch(() => "")
          const detailText = details ? ` ${details.slice(0, 240)}` : ""
          throw new Error(`Upload failed while sending media file (HTTP ${putRes.status}).${detailText}`)
        }

        if (!publishUrl) {
          throw new Error("Could not resolve uploaded media URL.")
        }
        if (!sourceMediaUrl) {
          sourceMediaUrl = publishUrl
        }

        const createRes = await fetch("/api/social-network/stories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaUrl: publishUrl,
            mediaType: publishMediaType,
            sourceMediaUrl,
            label: file.name || "Story",
            segments: publishSegments,
          }),
        })

        if (!createRes.ok) {
          const body = (await createRes.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error || "Could not publish story.")
        }

        if (publishMediaType === "video") {
          void fetch("/api/social-network/stories/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchSize: 2 }),
          }).catch(() => null)
        }
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.")
      setUploading(false)
      event.target.value = ""
      return
    }

    await loadStories(false)
    setUploading(false)
    event.target.value = ""
    openStory(viewerUserId)
  }

  return (
    <div className="h-dvh min-h-dvh bg-white text-slate-900">
      <div
        className={`grid h-full min-h-0 transition-[grid-template-columns] duration-200 ${
          isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH_CLASS : SIDEBAR_EXPANDED_WIDTH_CLASS
        }`}
      >
        <aside
          className={`hidden border-r border-slate-200 bg-white text-slate-900 transition-all duration-200 md:block ${
            isSidebarCollapsed ? "p-2" : "p-3 md:p-4"
          }`}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className={`mb-3 flex items-center ${isSidebarCollapsed ? "justify-center" : "justify-between"}`}>
              {!isSidebarCollapsed ? (
                <div className="px-1">
                  <p className="text-2xl font-semibold tracking-tight text-slate-900">UBEYE</p>
                </div>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size={isSidebarCollapsed ? "icon-sm" : "icon"}
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className={`text-slate-500 hover:bg-slate-100 hover:text-slate-900 ${
                  isSidebarCollapsed ? "h-8 w-8 rounded-md" : "h-9 w-9 rounded-lg"
                }`}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeftIcon className={`transition-transform ${isSidebarCollapsed ? "h-3.5 w-3.5 rotate-180" : "h-4 w-4"}`} />
              </Button>
            </div>

            <nav className={isSidebarCollapsed ? "flex flex-col items-center gap-2" : "grid grid-cols-1 gap-2"}>
              <Button
                type="button"
                variant="ghost"
                className={`shadow-none ${
                  isSidebarCollapsed
                    ? "size-9 justify-center rounded-lg p-0"
                    : "h-10 w-full justify-start rounded-lg px-3 text-base font-medium"
                } bg-slate-100 text-slate-900 hover:bg-slate-100`}
                onClick={onUploadClick}
                disabled={uploading}
                title={uploading ? "Uploading..." : "Add story"}
              >
                <Plus className="h-4 w-4" />
                <span className={isSidebarCollapsed ? "md:hidden" : ""}>{uploading ? "Uploading..." : "Add story"}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                asChild
                className={`shadow-none ${
                  isSidebarCollapsed
                    ? "size-9 justify-center rounded-lg p-0"
                    : "h-10 w-full justify-start rounded-lg px-3 text-base font-medium"
                } text-slate-700 hover:bg-slate-100 hover:text-slate-900`}
                title={setupCtaLabel}
              >
                <Link href={setupCtaHref}>
                  <User className="h-4 w-4" />
                  <span className={isSidebarCollapsed ? "md:hidden" : ""}>{setupCtaLabel}</span>
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                asChild
                className={`shadow-none ${
                  isSidebarCollapsed
                    ? "size-9 justify-center rounded-lg p-0"
                    : "h-10 w-full justify-start rounded-lg px-3 text-base font-medium"
                } text-slate-700 hover:bg-slate-100 hover:text-slate-900`}
                title="Following"
              >
                <Link href={FOLLOWING_PATH}>
                  <Users className="h-4 w-4" />
                  <span className={isSidebarCollapsed ? "md:hidden" : ""}>Following</span>
                </Link>
              </Button>
            </nav>

            {!isSidebarCollapsed ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Social handle</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">@{displayHandle}</p>
                <p className="mt-1 text-xs text-slate-500">Stories from people you follow appear first.</p>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex h-full min-w-0 flex-col bg-white">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 md:px-6">
            <div className="flex min-w-0 items-center">
              <p className="text-sm font-semibold tracking-tight text-slate-900 md:hidden">Social Network</p>
              <ProductSwitcher
                adNetworkHref={resolvedAdNetworkHref}
                consciousnessNetworkHref="/human-network/app"
                socialNetworkHref="/social-network/app"
                showSocialNetwork
                triggerClassName="hidden h-10 rounded-md px-2 text-xl font-medium text-slate-900 hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
                contentClassName="border-slate-200 bg-white text-slate-900"
                iconClassName="text-slate-500"
              />
            </div>

            <div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-900 hover:bg-slate-50"
                  >
                    {profileInitial}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">{userEmail || "Account"}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={resolvedProfileHref} className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={FOLLOWING_PATH} className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Following
                    </Link>
                  </DropdownMenuItem>
                  {showSetupMenuItem ? (
                    <DropdownMenuItem asChild>
                      <Link href={setupCtaHref} className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {setupCtaLabel}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSignOut} className="gap-2">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => void onUploadChange(event)}
          />

          <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
            <div className="mx-auto w-full max-w-3xl space-y-6">
              <div className="flex items-center gap-2 md:hidden">
                <Button size="sm" onClick={onUploadClick} disabled={uploading}>
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={setupCtaHref}>{setupCtaLabel}</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={FOLLOWING_PATH}>Following</Link>
                </Button>
              </div>

              {storiesError ? <p className="text-sm text-red-500">{storiesError}</p> : null}
              {relationshipError ? <p className="text-sm text-red-500">{relationshipError}</p> : null}
              {uploadError ? <p className="text-sm text-red-500">{uploadError}</p> : null}
              {storyDeleteError ? <p className="text-sm text-red-500">{storyDeleteError}</p> : null}
              {uploadInfo ? <p className="text-sm text-slate-600">{uploadInfo}</p> : null}

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-slate-500">Stories</h2>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={onUploadClick} disabled={uploading}>
                    <Plus className="h-4 w-4" />
                    {uploading ? "Uploading..." : "Add story"}
                  </Button>
                </div>

                {loadingStories ? (
                  <Card className="mt-3 p-4">
                    <p className="text-sm text-muted-foreground">Loading stories...</p>
                  </Card>
                ) : (
                  <>
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                      <button
                        type="button"
                        className="flex min-w-[88px] flex-col items-center gap-1.5"
                        onClick={onYourStoryClick}
                        aria-label={viewerHasStory ? "View your story" : "Add to your story"}
                      >
                        <div
                          className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 text-xs font-semibold uppercase ${
                            viewerHasStory
                              ? "border-foreground text-foreground"
                              : "border-dashed border-muted-foreground/40 text-muted-foreground"
                          }`}
                        >
                          {initialsFor(viewerStoryHandle)}
                          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-foreground text-white">
                            <Plus className="h-3 w-3" />
                          </span>
                        </div>
                        <span className="max-w-[88px] truncate text-xs font-medium text-foreground">Your story</span>
                        <span className="text-[11px] text-muted-foreground">{viewerHasStory ? "View" : "Add"}</span>
                      </button>

                      {storiesRowUsers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="flex min-w-[76px] flex-col items-center gap-1.5"
                          onClick={() => openStory(user.id)}
                        >
                          <div
                            className={`flex h-16 w-16 items-center justify-center rounded-full border-2 text-xs font-semibold uppercase ${
                              user.hasUnseen ? "border-foreground" : "border-muted-foreground/30 text-muted-foreground"
                            }`}
                          >
                            {initialsFor(user.handle)}
                          </div>
                          <span
                            className={`max-w-[80px] truncate text-xs ${
                              user.hasUnseen ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            @{user.handle}
                          </span>
                        </button>
                      ))}
                    </div>

                    {storiesRowUsers.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">Follow people to fill the story row.</p>
                    ) : null}
                  </>
                )}
              </section>

              <section>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search people"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                {searchQuery ? (
                  <div className="mt-3 space-y-2">
                    {directoryError ? (
                      <Card className="p-3">
                        <p className="text-sm text-red-500">{directoryError}</p>
                      </Card>
                    ) : loadingDirectoryPeople && searchResults.length === 0 ? (
                      <Card className="p-3">
                        <p className="text-sm text-muted-foreground">Searching people...</p>
                      </Card>
                    ) : searchResults.length === 0 ? (
                      <Card className="p-3">
                        <p className="text-sm text-muted-foreground">No people found.</p>
                      </Card>
                    ) : (
                      <>
                        {searchResults.map((person) => (
                          <Card key={`search-${person.id}`} className="p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-medium">@{person.handle}</p>
                                <p className="text-xs text-muted-foreground">{person.name}</p>
                              </div>

                              {person.id === viewerUserId ? (
                                <Button size="sm" variant="outline" disabled>
                                  You
                                </Button>
                              ) : person.relationship.hasBlockedYou ? (
                                <Button size="sm" variant="outline" disabled>
                                  Blocked you
                                </Button>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  {person.hasStory ? (
                                    <Button size="sm" variant="outline" onClick={() => openStory(person.id)}>
                                      Watch
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline" disabled>
                                      No story
                                    </Button>
                                  )}

                                  <Button
                                    size="sm"
                                    variant={person.relationship.isFollowing ? "outline" : "default"}
                                    disabled={relationshipBusyUserId === person.id || person.relationship.isBlocked}
                                    onClick={() =>
                                      void updateRelationship(
                                        person.id,
                                        person.relationship.isFollowing ? "unfollow" : "follow",
                                      )
                                    }
                                  >
                                    {person.relationship.isFollowing ? "Following" : "Follow"}
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={relationshipBusyUserId === person.id || person.relationship.isBlocked}
                                    onClick={() =>
                                      void updateRelationship(
                                        person.id,
                                        person.relationship.isMuted ? "unmute" : "mute",
                                      )
                                    }
                                  >
                                    {person.relationship.isMuted ? "Unmute" : "Mute"}
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className={person.relationship.isBlocked ? "border-red-500 text-red-600 hover:bg-red-50" : "border-red-200 text-red-600 hover:bg-red-50"}
                                    disabled={relationshipBusyUserId === person.id}
                                    onClick={() =>
                                      void updateRelationship(
                                        person.id,
                                        person.relationship.isBlocked ? "unblock" : "block",
                                      )
                                    }
                                  >
                                    {person.relationship.isBlocked ? "Unblock" : "Block"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </Card>
                        ))}
                        {directoryHasMore ? <div ref={directoryLoadMoreRef} className="h-5" /> : null}
                        {loadingDirectoryPeople && searchResults.length > 0 ? (
                          <p className="px-1 text-xs text-muted-foreground">Loading more people…</p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </section>

              <section>
                <h2 className="text-base font-semibold tracking-tight">For You</h2>
                <div className="mt-3">
                  {loadingForYou ? (
                    <Card className="p-4">
                      <p className="text-sm text-muted-foreground">Loading For You...</p>
                    </Card>
                  ) : forYouError ? (
                    <Card className="p-4">
                      <p className="text-sm text-red-500">{forYouError}</p>
                    </Card>
                  ) : forYouTiles.length === 0 ? (
                    <Card className="p-4">
                      <p className="text-sm text-muted-foreground">No people to discover yet.</p>
                    </Card>
                  ) : (
                    <div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {forYouTiles.map((tile) => (
                          <div key={`for-you-${tile.id}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                            {tile.previewItem ? (
                              <button
                                type="button"
                                className="absolute inset-0 z-10"
                                onClick={() => openStory(tile.id)}
                                aria-label={`Open @${tile.handle} story`}
                              >
                                <Image
                                  src={tile.previewItem.url}
                                  alt={`@${tile.handle}`}
                                  fill
                                  unoptimized
                                  className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                />
                              </button>
                            ) : tile.hasStory ? (
                              <button
                                type="button"
                                className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100 text-slate-500"
                                onClick={() => openStory(tile.id)}
                                aria-label={`Open @${tile.handle} story`}
                              >
                                <span className="text-xl font-semibold uppercase">{initialsFor(tile.handle)}</span>
                              </button>
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-500">
                                <span className="text-xl font-semibold uppercase">{initialsFor(tile.handle)}</span>
                              </div>
                            )}

                            {tile.previewItem && !tile.previewItem.seen ? (
                              <div className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-white shadow" />
                            ) : null}
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 py-1">
                              <p className="truncate text-left text-xs font-medium text-white">@{tile.handle}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {forYouHasMore ? <div ref={forYouLoadMoreRef} className="h-8" /> : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Loaded {forYouTiles.length.toLocaleString()} people
                        {loadingForYouMore ? " • Loading more…" : ""}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-2 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <Button
            type="button"
            variant="ghost"
            onClick={onUploadClick}
            disabled={uploading}
            className="h-12 flex-col gap-1 rounded-xl bg-slate-100 text-slate-900 hover:bg-slate-100 hover:text-slate-900"
          >
            <Plus className="h-4 w-4" />
            <span className="text-[11px] font-medium">{uploading ? "Uploading..." : "Add"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-12 flex-col gap-1 rounded-xl text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                <Compass className="h-4 w-4" />
                <span className="text-[11px] font-medium">Network</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56">
              <DropdownMenuLabel>Switch product</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={resolvedAdNetworkHref}>Ad Network</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/human-network/app">Human Network</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/social-network/app" className="font-medium">
                  Social Network
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-12 flex-col gap-1 rounded-xl text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                <User className="h-4 w-4" />
                <span className="text-[11px] font-medium">Account</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">{userEmail || "Account"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={resolvedProfileHref} className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={FOLLOWING_PATH} className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Following
                </Link>
              </DropdownMenuItem>
              {showSetupMenuItem ? (
                <DropdownMenuItem asChild>
                  <Link href={setupCtaHref} className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {setupCtaLabel}
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleSignOut} className="gap-2">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {activeUser && activeItem ? (
        <div className="fixed inset-0 z-50 bg-black/95">
          <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center px-4 py-6">
            <div className="relative h-full max-h-[92vh] w-full max-w-[430px] overflow-hidden rounded-[30px] border border-white/20 bg-black shadow-2xl">
              <div className="absolute inset-x-3 top-3 z-30 flex gap-1">
                {activeUser.items.map((item, index) => {
                  const fillPercent = index < activeIndex ? 100 : index === activeIndex ? Math.floor(storyProgress * 100) : 0
                  return (
                    <div key={`${activeUser.id}-${item.id}`} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                      <div
                        className="h-full bg-white transition-[width] duration-100 ease-linear"
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  )
                })}
              </div>

              <div className="absolute inset-x-4 top-6 z-30 flex items-center justify-between text-white">
                <p className="text-sm font-semibold">
                  @{activeUser.handle} • {activeIndex + 1}/{activeUser.items.length}
                </p>
                <div className="flex items-center gap-2">
                  {activeUser.id !== viewerUserId &&
                  !activeUser.relationship.hasBlockedYou &&
                  !activeUser.relationship.isFollowing ? (
                    <button
                      type="button"
                      className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black shadow-sm transition hover:bg-white/90 disabled:opacity-50 sm:text-sm"
                      onClick={() => {
                        void updateRelationship(activeUser.id, "follow")
                      }}
                      disabled={relationshipBusyUserId === activeUser.id || activeUser.relationship.isBlocked}
                      aria-label={`Follow @${activeUser.handle}`}
                    >
                      Follow
                    </button>
                  ) : null}
                  {isViewingOwnStory ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="rounded-full border border-white/40 bg-black/30 p-2 text-white backdrop-blur disabled:opacity-50"
                          disabled={deletingStoryId === activeItem.id}
                          aria-label="Story management"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Your story</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={deletingStoryId === activeItem.id}
                          onSelect={() => {
                            void deleteOwnStory("frame")
                          }}
                        >
                          {deletingStoryId === activeItem.id && deletingStoryScope === "frame"
                            ? "Deleting frame..."
                            : "Delete this frame"}
                        </DropdownMenuItem>
                        {canDeleteEntireUpload ? (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={deletingStoryId === activeItem.id}
                            onSelect={() => {
                              void deleteOwnStory("upload")
                            }}
                          >
                            {deletingStoryId === activeItem.id && deletingStoryScope === "upload"
                              ? "Deleting upload..."
                              : "Delete entire upload"}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : activeUser.id !== viewerUserId && !activeUser.relationship.hasBlockedYou ? (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded-full border border-white/40 bg-black/30 p-2 text-white backdrop-blur disabled:opacity-50"
                            disabled={relationshipBusyUserId === activeUser.id}
                            aria-label="Story actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {activeUser.relationship.isFollowing ? (
                            <DropdownMenuItem
                              disabled={relationshipBusyUserId === activeUser.id || activeUser.relationship.isBlocked}
                              onSelect={() => {
                                void updateRelationship(activeUser.id, "unfollow")
                              }}
                            >
                              Unfollow
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            disabled={relationshipBusyUserId === activeUser.id || activeUser.relationship.isBlocked}
                            onSelect={() => {
                              void updateRelationship(
                                activeUser.id,
                                activeUser.relationship.isMuted ? "unmute" : "mute",
                              )
                            }}
                          >
                            {activeUser.relationship.isMuted ? "Unmute" : "Mute"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant={activeUser.relationship.isBlocked ? "default" : "destructive"}
                            disabled={relationshipBusyUserId === activeUser.id}
                            onSelect={() => {
                              void updateRelationship(
                                activeUser.id,
                                activeUser.relationship.isBlocked ? "unblock" : "block",
                              )
                            }}
                          >
                            {activeUser.relationship.isBlocked ? "Unblock" : "Block"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded-full border border-white/40 bg-black/30 p-2 text-white backdrop-blur disabled:opacity-50"
                            disabled={reportingStoryId === activeItem.id}
                            aria-label="Report story"
                          >
                            <Flag className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Report story</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {SOCIAL_REPORT_REASON_OPTIONS.map((option) => (
                            <DropdownMenuItem
                              key={option.value}
                              onClick={() => {
                                void submitStoryReport(activeItem.id, option.value)
                              }}
                            >
                              {option.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-full border border-white/40 bg-black/30 p-2 text-white backdrop-blur"
                    onClick={closeStory}
                    aria-label="Close story"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="absolute inset-y-0 left-0 z-20 w-1/3 cursor-w-resize bg-transparent"
                onClick={goPrev}
                aria-label="Previous story frame"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 z-20 w-1/3 cursor-e-resize bg-transparent"
                onClick={goNext}
                aria-label="Next story frame"
              />

              <div className="h-full w-full bg-black">
                {activeItem.kind === "video" ? (
                  <video
                    key={activeItem.id}
                    src={activeItem.url}
                    poster={activeItem.thumbnailUrl || undefined}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-contain"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget
                      if (Number.isFinite(video.duration) && video.duration > 0 && activeClipStartSeconds >= video.duration) {
                        setStoryProgress(1)
                        advanceFromActiveVideoSegment()
                        return
                      }
                      if (activeClipStartSeconds > 0 && Number.isFinite(video.duration) && video.duration > activeClipStartSeconds) {
                        video.currentTime = activeClipStartSeconds
                      }
                    }}
                    onTimeUpdate={(event) => {
                      const video = event.currentTarget
                      const duration = Number.isFinite(video.duration) ? video.duration : 0
                      if (duration <= 0) return
                      const clipStart = Math.max(0, activeClipStartSeconds)
                      const clipDuration = activeClipDurationSeconds
                      const clipEnd = clipDuration ? Math.min(duration, clipStart + clipDuration) : duration

                      if (clipDuration && video.currentTime >= clipEnd - 0.05) {
                        setStoryProgress(1)
                        advanceFromActiveVideoSegment()
                        return
                      }

                      if (clipDuration) {
                        const elapsed = Math.max(0, video.currentTime - clipStart)
                        setStoryProgress(Math.max(0, Math.min(1, elapsed / clipDuration)))
                        return
                      }

                      setStoryProgress(Math.max(0, Math.min(1, video.currentTime / duration)))
                    }}
                    onEnded={advanceFromActiveVideoSegment}
                  />
                ) : (
                  <Image
                    src={activeItem.url}
                    alt={activeItem.label}
                    fill
                    sizes="(max-width: 640px) 100vw, 430px"
                    unoptimized
                    className="object-contain"
                  />
                )}
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/75 via-black/45 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

              <div className="pointer-events-none absolute inset-x-4 bottom-6 z-30 text-white">
                <p className="line-clamp-2 text-sm font-medium">{activeItem.label}</p>
                <p className="mt-1 text-xs text-white/70">Tap right for next frame</p>
                {storyDeleteError ? <p className="mt-2 text-xs text-red-300">{storyDeleteError}</p> : null}
                {reportError ? <p className="mt-2 text-xs text-red-300">{reportError}</p> : null}
                {reportSuccess ? <p className="mt-2 text-xs text-emerald-200">{reportSuccess}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
