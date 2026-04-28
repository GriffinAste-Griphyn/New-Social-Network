"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type RelationshipState = {
  isFollowing: boolean
  isMuted: boolean
  isBlocked: boolean
  hasBlockedYou: boolean
}

type SocialFollowingPerson = {
  id: string
  handle: string
  name: string
  hasStory: boolean
  relationship: RelationshipState
}

type FollowingAction = "unfollow" | "mute" | "unmute"

const FOLLOWING_PATH = "/social-network/following"
const PROFILE_PATH = "/social-network/profile"
const ANALYTICS_PATH = "/social-network/profile/analytics"
const SOCIAL_APP_PATH = "/social-network/app"

function deriveHandle(email: string, claimedUsername: string) {
  if (claimedUsername.trim()) return claimedUsername.trim()
  const local = email.trim().toLowerCase().split("@")[0] || ""
  const normalized = local.replace(/[^a-z0-9._-]/g, "").slice(0, 15)
  return normalized.length >= 3 ? normalized : "guest"
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

export default function SocialNetworkFollowingPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")

  const [search, setSearch] = useState("")
  const [loadingFollowing, setLoadingFollowing] = useState(false)
  const [followingError, setFollowingError] = useState<string | null>(null)
  const [actionUserId, setActionUserId] = useState<string | null>(null)
  const [followingPeople, setFollowingPeople] = useState<SocialFollowingPerson[]>([])

  const displayHandle = useMemo(() => deriveHandle(email, username), [email, username])

  const loadFollowingPeople = async () => {
    setLoadingFollowing(true)
    setFollowingError(null)

    const response = await fetch("/api/social-network/stories", { cache: "no-store" }).catch(() => null)
    if (!response || !response.ok) {
      const body = response ? await response.json().catch(() => null) : null
      setFollowingPeople([])
      setFollowingError(body?.error || "Could not load following right now.")
      setLoadingFollowing(false)
      return
    }

    const body = (await response.json().catch(() => null)) as
      | {
          people?: Array<{
            id?: string
            handle?: string
            name?: string
            hasStory?: boolean
            relationship?: {
              isFollowing?: boolean
              isMuted?: boolean
              isBlocked?: boolean
              hasBlockedYou?: boolean
            }
          }>
        }
      | null

    const rows = Array.isArray(body?.people) ? body.people : []

    const nextFollowing = rows
      .filter((person): person is NonNullable<typeof person> => {
        return Boolean(person && typeof person.id === "string")
      })
      .map((person) => ({
        id: person.id as string,
        handle: typeof person.handle === "string" ? person.handle : "user",
        name: typeof person.name === "string" ? person.name : "User",
        hasStory: person.hasStory === true,
        relationship: normalizeRelationship(person.relationship),
      }))
      .filter((person) => person.relationship.isFollowing === true)
      .sort((a, b) => a.handle.localeCompare(b.handle))

    setFollowingPeople(nextFollowing)
    setLoadingFollowing(false)
  }

  const applyFollowingAction = async (targetUserId: string, action: FollowingAction) => {
    if (!targetUserId) return

    setActionUserId(targetUserId)
    setFollowingError(null)

    const response = await fetch("/api/social-network/relationships", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, action }),
    }).catch(() => null)

    setActionUserId(null)

    if (!response || !response.ok) {
      const body = response ? await response.json().catch(() => null) : null
      setFollowingError(body?.error || "Could not update following settings.")
      return
    }

    if (action === "unfollow") {
      setFollowingPeople((previous) => previous.filter((person) => person.id !== targetUserId))
      return
    }

    setFollowingPeople((previous) =>
      previous.map((person) => {
        if (person.id !== targetUserId) return person
        return {
          ...person,
          relationship: {
            ...person.relationship,
            isMuted: action === "mute",
          },
        }
      }),
    )
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const meResponse = await fetch("/api/auth/me").catch(() => null)
      if (!meResponse || !meResponse.ok) {
        router.replace(`/login?callbackUrl=${encodeURIComponent(FOLLOWING_PATH)}`)
        return
      }

      const meData = await meResponse.json().catch(() => null)
      const role = meData?.user?.role
      if (role !== "VIEWER" && role !== "ADMIN") {
        router.replace("/social-network?error=viewer-profile-required")
        return
      }

      const emailVerified = !!meData?.user?.emailVerified
      const profileCompleted = meData?.user?.viewerProfileCompleted === true
      const rawEmail = typeof meData?.user?.email === "string" ? meData.user.email : ""
      setEmail(rawEmail)

      if (!emailVerified) {
        router.replace(`/signup/viewer/verify?callbackUrl=${encodeURIComponent(FOLLOWING_PATH)}`)
        return
      }

      if (!profileCompleted) {
        router.replace(`/viewer/onboarding?callbackUrl=${encodeURIComponent(FOLLOWING_PATH)}`)
        return
      }

      const profileRes = await fetch("/api/viewer/profile", { cache: "no-store" }).catch(() => null)
      if (profileRes && profileRes.ok) {
        const profileData = await profileRes.json().catch(() => null)
        const claimed = typeof profileData?.profile?.username === "string" ? profileData.profile.username : ""
        setUsername(claimed)
      }

      await loadFollowingPeople()
      setLoading(false)
    }

    void load()
  }, [router])

  const filteredFollowing = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return followingPeople
    return followingPeople.filter((person) => {
      return person.handle.toLowerCase().includes(query) || person.name.toLowerCase().includes(query)
    })
  }, [followingPeople, search])

  const totalFollowing = followingPeople.length
  const storyFollowing = followingPeople.filter((person) => person.hasStory).length
  const mutedFollowing = followingPeople.filter((person) => person.relationship.isMuted).length

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <Link href={SOCIAL_APP_PATH} className="text-xl font-semibold tracking-tight">
            UBEYE
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <Link href={SOCIAL_APP_PATH} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to social network
          </Link>

          <h1 className="text-3xl font-bold tracking-tight mb-2">Following</h1>
          <p className="text-muted-foreground mb-6">Manage the accounts you follow as @{displayHandle}.</p>

          <div className="mb-6 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={PROFILE_PATH}>Profile</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={ANALYTICS_PATH}>Analytics</Link>
            </Button>
            <Button size="sm" type="button" className="cursor-default" disabled>
              Following
            </Button>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Following</p>
              <p className="mt-1 text-2xl font-semibold">{totalFollowing.toLocaleString()}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">With active story</p>
              <p className="mt-1 text-2xl font-semibold">{storyFollowing.toLocaleString()}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Muted</p>
              <p className="mt-1 text-2xl font-semibold">{mutedFollowing.toLocaleString()}</p>
            </Card>
          </div>

          <Card className="p-4 mb-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search followed accounts"
                aria-label="Search followed accounts"
              />
            </div>
          </Card>

          <Card className="p-4">
            {loadingFollowing ? (
              <p className="text-sm text-muted-foreground">Loading followed accounts...</p>
            ) : filteredFollowing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {followingPeople.length === 0 ? "You are not following anyone yet." : "No followed accounts match your search."}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredFollowing.map((person) => {
                  const isBusy = actionUserId === person.id
                  return (
                    <div key={person.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">@{person.handle}</p>
                        <p className="truncate text-xs text-muted-foreground">{person.name}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {person.hasStory ? "Active story" : "No active story"}
                          {person.relationship.isMuted ? " • Muted" : ""}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {person.hasStory ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={SOCIAL_APP_PATH}>Open</Link>
                          </Button>
                        ) : null}

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void applyFollowingAction(person.id, person.relationship.isMuted ? "unmute" : "mute")}
                        >
                          {isBusy ? "Updating..." : person.relationship.isMuted ? "Unmute" : "Mute"}
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          disabled={isBusy}
                          onClick={() => void applyFollowingAction(person.id, "unfollow")}
                        >
                          {isBusy ? "Updating..." : "Unfollow"}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {followingError ? <p className="mt-3 text-sm text-red-500">{followingError}</p> : null}
          </Card>

          {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
        </div>
      </main>
    </div>
  )
}
