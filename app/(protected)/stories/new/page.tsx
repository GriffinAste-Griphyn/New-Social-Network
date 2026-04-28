import { ArrowLeft } from "lucide-react"

import { StoryCreateForm } from "@/components/app/story-create-form"
import { enableCreatorToolsAction } from "@/lib/auth-actions"
import { requireSession } from "@/lib/auth"
import { getMyStoryStack } from "@/lib/story-store"
import { Button } from "@/components/ui/button"

export default async function NewStoryPage() {
  const session = await requireSession()
  const myStory = await getMyStoryStack(session.id)

  return (
    <main className="min-h-screen bg-[#eef0f3] px-4 py-5 text-[#17191f] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-white px-4 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3">
            <a
              href="/feed"
              aria-label="Back to feed"
              className="flex size-10 items-center justify-center rounded-full bg-[#f5f6f8] text-[#374151]"
            >
              <ArrowLeft className="size-5" />
            </a>
            <div>
              <p className="text-sm text-[#6b7280]">@{session.handle}</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                New story
              </h1>
            </div>
          </div>

          <a
            href="/stories/me"
            className="rounded-full bg-[#f5f6f8] px-3 py-1.5 text-sm font-medium text-[#374151]"
          >
            {myStory.liveCount} active
          </a>
        </header>

        {session.creatorStatus === "active" ? (
          <StoryCreateForm />
        ) : (
          <section className="rounded-[8px] bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
            <div className="max-w-xl">
              <p className="text-sm font-medium text-[#6b7280]">Account setup</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Turn on posting before creating a story.
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#6b7280]">
                Your account stays the same. This turns on story posting,
                earning settings, and analytics for @{session.handle}.
              </p>
              <form action={enableCreatorToolsAction} className="mt-5">
                <input type="hidden" name="next" value="/stories/new" />
                <Button type="submit" className="rounded-[8px] bg-[#111827] text-white">
                  Turn on posting
                </Button>
              </form>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
