"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type SocialSettingsPerson = {
  id: string
  handle: string
  name: string
}

const PROFILE_PATH = "/social-network/profile"
const ANALYTICS_PATH = "/social-network/profile/analytics"
const FOLLOWING_PATH = "/social-network/following"
const CLAIM_USERNAME_PATH = "/social-network/claim-username"
const SOCIAL_APP_PATH = "/social-network/app"

function deriveHandle(email: string, claimedUsername: string) {
  if (claimedUsername.trim()) return claimedUsername.trim()
  const local = email.trim().toLowerCase().split("@")[0] || ""
  const normalized = local.replace(/[^a-z0-9._-]/g, "").slice(0, 15)
  return normalized.length >= 3 ? normalized : "guest"
}

export default function SocialNetworkProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")

  const [socialSettingsError, setSocialSettingsError] = useState<string | null>(null)
  const [loadingMutedPeople, setLoadingMutedPeople] = useState(false)
  const [mutedActionUserId, setMutedActionUserId] = useState<string | null>(null)
  const [mutedPeople, setMutedPeople] = useState<SocialSettingsPerson[]>([])

  const displayHandle = useMemo(() => deriveHandle(email, username), [email, username])
  const hasClaimedUsername = username.trim().length > 0

  const loadMutedPeople = async () => {
    setLoadingMutedPeople(true)
    setSocialSettingsError(null)

    const response = await fetch("/api/social-network/stories", { cache: "no-store" }).catch(() => null)
    if (!response || !response.ok) {
      setLoadingMutedPeople(false)
      return
    }

    const body = (await response.json().catch(() => null)) as
      | {
          people?: Array<{
            id?: string
            handle?: string
            name?: string
            relationship?: {
              isMuted?: boolean
              isBlocked?: boolean
            }
          }>
        }
      | null

    const rows = Array.isArray(body?.people) ? body.people : []
    const nextMuted = rows
      .filter((person) => {
        if (!person || typeof person.id !== "string") return false
        const relationship = person.relationship || {}
        return relationship.isMuted === true && relationship.isBlocked !== true
      })
      .map((person) => ({
        id: person.id as string,
        handle: typeof person.handle === "string" ? person.handle : "user",
        name: typeof person.name === "string" ? person.name : "User",
      }))
      .sort((a, b) => a.handle.localeCompare(b.handle))

    setMutedPeople(nextMuted)
    setLoadingMutedPeople(false)
  }

  const handleUnmute = async (targetUserId: string) => {
    if (!targetUserId) return
    setMutedActionUserId(targetUserId)
    setSocialSettingsError(null)

    const response = await fetch("/api/social-network/relationships", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, action: "unmute" }),
    }).catch(() => null)

    setMutedActionUserId(null)

    if (!response || !response.ok) {
      const body = response ? await response.json().catch(() => null) : null
      setSocialSettingsError(body?.error || "Could not update muted accounts.")
      return
    }

    setMutedPeople((previous) => previous.filter((person) => person.id !== targetUserId))
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const meResponse = await fetch("/api/auth/me").catch(() => null)
      if (!meResponse || !meResponse.ok) {
        router.replace(`/login?callbackUrl=${encodeURIComponent(PROFILE_PATH)}`)
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
        router.replace(`/signup/viewer/verify?callbackUrl=${encodeURIComponent(PROFILE_PATH)}`)
        return
      }
      if (!profileCompleted) {
        router.replace(`/viewer/onboarding?callbackUrl=${encodeURIComponent(PROFILE_PATH)}`)
        return
      }

      const profileRes = await fetch("/api/viewer/profile", { cache: "no-store" }).catch(() => null)
      if (profileRes && profileRes.ok) {
        const profileData = await profileRes.json().catch(() => null)
        const claimed = typeof profileData?.profile?.username === "string" ? profileData.profile.username : ""
        setUsername(claimed)
      }

      await loadMutedPeople()
      setLoading(false)
    }

    void load()
  }, [router])

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

          <h1 className="text-3xl font-bold tracking-tight mb-2">Social Profile</h1>
          <p className="text-muted-foreground mb-6">
            Social profile is separate from your ad network profile.
          </p>

          <div className="mb-6 flex flex-wrap gap-2">
            <Button size="sm" type="button" className="cursor-default" disabled>
              Profile
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={ANALYTICS_PATH}>Analytics</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={FOLLOWING_PATH}>Following</Link>
            </Button>
          </div>

          <Card className="p-6 mb-6 border border-dashed">
            <h2 className="text-lg font-semibold mb-1">Social handle</h2>
            <p className="text-sm text-muted-foreground mb-4">This is your identity in the social network.</p>
            <p className="text-2xl font-semibold tracking-tight">@{displayHandle}</p>
            <p className="text-xs text-muted-foreground mt-2">{hasClaimedUsername ? "Username claimed" : "Using temporary handle"}</p>
            {!hasClaimedUsername ? (
              <Button className="mt-4" asChild>
                <Link href={CLAIM_USERNAME_PATH}>Claim username</Link>
              </Button>
            ) : null}
          </Card>

          <Card className="p-6 mb-6 border border-dashed">
            <h2 className="text-lg font-semibold mb-1">Social settings</h2>
            <p className="text-sm text-muted-foreground mb-4">Manage who you muted in stories.</p>

            {loadingMutedPeople ? (
              <p className="text-sm text-muted-foreground">Loading muted accounts...</p>
            ) : mutedPeople.length === 0 ? (
              <p className="text-sm text-muted-foreground">No muted accounts.</p>
            ) : (
              <div className="space-y-2">
                {mutedPeople.map((person) => (
                  <div key={person.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">@{person.handle}</p>
                      <p className="truncate text-xs text-muted-foreground">{person.name}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mutedActionUserId === person.id}
                      onClick={() => void handleUnmute(person.id)}
                    >
                      {mutedActionUserId === person.id ? "Updating..." : "Unmute"}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {socialSettingsError ? <p className="mt-3 text-sm text-red-500">{socialSettingsError}</p> : null}
          </Card>

          <Card className="p-6 border border-dashed">
            <h2 className="text-lg font-semibold mb-1">Ad network profile</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your ad targeting and demographic profile is managed separately.
            </p>
            <Button variant="outline" asChild>
              <Link href="/viewer/profile">Open ad network profile</Link>
            </Button>
          </Card>

          {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
        </div>
      </main>
    </div>
  )
}
