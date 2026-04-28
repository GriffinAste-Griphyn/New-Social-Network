"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const CLAIM_PATH = "/social-network/claim-username"
const APP_PATH = "/social-network/app"

export default function ClaimUsernamePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")

  const loginHref = useMemo(
    () => `/login?callbackUrl=${encodeURIComponent(CLAIM_PATH)}`,
    [],
  )

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const meRes = await fetch("/api/auth/me").catch(() => null)
      if (!meRes || !meRes.ok) {
        router.replace(loginHref)
        return
      }

      const meData = await meRes.json().catch(() => null)
      const role = meData?.user?.role
      if (role !== "VIEWER" && role !== "ADMIN") {
        router.replace("/social-network?error=viewer-profile-required")
        return
      }

      const rawEmail = typeof meData?.user?.email === "string" ? meData.user.email.trim() : ""
      setEmail(rawEmail)
      const profileRes = await fetch("/api/viewer/profile").catch(() => null)
      if (!profileRes || !profileRes.ok) {
        router.replace(`/viewer/onboarding?callbackUrl=${encodeURIComponent(CLAIM_PATH)}`)
        return
      }

      const profileData = await profileRes.json().catch(() => null)
      const profile = profileData?.profile
      if (!profile || profile.profileCompleted !== true) {
        router.replace(`/viewer/onboarding?callbackUrl=${encodeURIComponent(CLAIM_PATH)}`)
        return
      }

      if (typeof profile.username === "string" && profile.username.trim()) {
        router.replace(APP_PATH)
        return
      }

      const suggested = rawEmail ? rawEmail.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") : ""
      setUsername(suggested.slice(0, 15))
      setLoading(false)
    }

    void load()
  }, [loginHref, router])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const normalized = username.trim().toLowerCase()
    if (!normalized) {
      setError("Enter a username.")
      setSaving(false)
      return
    }
    if (normalized.length > 15) {
      setError("Username must be 15 characters or fewer.")
      setSaving(false)
      return
    }

    const res = await fetch("/api/social-network/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: normalized }),
    }).catch(() => null)

    setSaving(false)

    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null
      setError(body?.error || "Could not claim username.")
      return
    }

    router.push(APP_PATH)
    router.refresh()
  }

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
          <Link href="/social-network" className="text-xl font-semibold tracking-tight">
            UBEYE
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Claim your username</h1>
          <p className="text-muted-foreground mb-8">
            Your username is your network handle. You&apos;ll use it as your channel identity.
          </p>

          <Card className="p-6">
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="username-input">
                  Username
                </label>
                <Input
                  id="username-input"
                  placeholder="your_username"
                  value={username}
                  maxLength={15}
                  onChange={(event) => setUsername(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  3-15 characters. Letters, numbers, dots, underscores, and hyphens only.
                </p>
              </div>

              {email ? (
                <p className="text-xs text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{email}</span>
                </p>
              ) : null}

              {error ? <p className="text-sm text-red-500">{error}</p> : null}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button type="submit" disabled={saving} className="sm:flex-1">
                  {saving ? "Claiming..." : "Claim username"}
                </Button>
                <Button type="button" variant="outline" className="sm:flex-1" onClick={() => router.push("/social-network")}>
                  Back
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </main>
    </div>
  )
}
