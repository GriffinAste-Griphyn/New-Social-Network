"use client"

import { useState } from "react"
import { Ban, ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { BlockedUserProfile } from "@/lib/safety-store"

export function BlockedUsersClient({
  initialBlockedUsers,
}: {
  initialBlockedUsers: BlockedUserProfile[]
}) {
  const [blockedUsers, setBlockedUsers] = useState(initialBlockedUsers)
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unblockUser = async (blockedUserId: string) => {
    setUnblockingUserId(blockedUserId)
    setError(null)

    try {
      const response = await fetch("/api/blocks", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blockedUserId }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not unblock this user.")
      }

      setBlockedUsers((current) =>
        current.filter((user) => user.id !== blockedUserId),
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not unblock this user.",
      )
    } finally {
      setUnblockingUserId(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f4f6] px-4 py-5 text-[#111827] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="rounded-[8px] border border-[#e5e7eb] bg-white p-4 shadow-sm">
          <a
            href="/feed"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#6b7280] hover:text-[#111827]"
          >
            <ChevronLeft className="size-4" />
            Back to feed
          </a>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#374151]">
              <Ban className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-[#6b7280]">Safety</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                Blocked users
              </h1>
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-[8px] border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm text-[#be123c]">
            {error}
          </div>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-sm">
          {blockedUsers.length > 0 ? (
            blockedUsers.map((user) => (
              <article
                className="flex items-center gap-3 border-t border-[#e5e7eb] p-4 first:border-t-0"
                key={user.id}
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-sm font-semibold">
                  {user.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-sm text-[#6b7280]">
                    @{user.handle.replace(/^@/, "")}
                  </p>
                </div>
                <Button
                  disabled={unblockingUserId === user.id}
                  onClick={() => unblockUser(user.id)}
                  type="button"
                  variant="outline"
                >
                  {unblockingUserId === user.id ? "Unblocking..." : "Unblock"}
                </Button>
              </article>
            ))
          ) : (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-semibold">No blocked users</p>
              <p className="mt-2 text-sm text-[#6b7280]">
                Accounts you block from stories or profiles will appear here.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
