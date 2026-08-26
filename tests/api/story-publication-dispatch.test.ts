import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import {
  completeStoryPublicationCore,
  fanoutStoryPublicationCore,
  invalidateStoryPublicationSnapshotsCore,
  notifyStoryPublicationCore,
  processStoryPublicationEarningsCore,
  validateStoryPublicationCore,
} from "@/workflows/story-publication/steps"

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }))
vi.mock("@/workflows/story-publication/steps", () => ({
  completeStoryPublicationCore: vi.fn(),
  failStoryPublicationCore: vi.fn(),
  fanoutStoryPublicationCore: vi.fn(),
  invalidateStoryPublicationSnapshotsCore: vi.fn(),
  notifyStoryPublicationCore: vi.fn(),
  processStoryPublicationEarningsCore: vi.fn(),
  validateStoryPublicationCore: vi.fn(),
}))

function publicationDb(
  dispatch: {
    status: string
    workflowRunId: string | null
    attempts: number
    updatedAt: Date
  } = {
    status: "pending",
    workflowRunId: null,
    attempts: 0,
    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  },
) {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  const selectLimit = vi.fn().mockResolvedValue([dispatch])
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const from = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from }))
  const returning = vi.fn().mockResolvedValue([{ attempts: dispatch.attempts + 1 }])
  const updateWhere = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set }))

  return { insert, select, update }
}

describe("story publication dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(publicationDb() as never)
    vi.mocked(validateStoryPublicationCore).mockResolvedValue({
      storyId: "story_123",
      creatorId: "creator_123",
      creatorName: "Creator",
      caption: null,
      createdAt: new Date(),
    })
  })

  it("claims and completes the durable publication directly by default", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(enqueueStoryPublication("story_123")).resolves.toBe("story_123")
    expect(validateStoryPublicationCore).toHaveBeenCalledWith("story_123")
    expect(processStoryPublicationEarningsCore).toHaveBeenCalledWith("story_123")
    expect(fanoutStoryPublicationCore).toHaveBeenCalledWith("story_123")
    expect(notifyStoryPublicationCore).toHaveBeenCalledWith("story_123")
    expect(invalidateStoryPublicationSnapshotsCore).toHaveBeenCalledWith(
      "story_123",
    )
    expect(completeStoryPublicationCore).toHaveBeenCalledWith("story_123")
  })

  it("allows bulk callers to opt out and leave only the outbox row", async () => {
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(
      enqueueStoryPublication("story_123", { dispatch: false }),
    ).resolves.toBeNull()
    expect(validateStoryPublicationCore).not.toHaveBeenCalled()
  })

  it("stops dispatching after the bounded attempt limit", async () => {
    vi.mocked(getDb).mockReturnValue(
      publicationDb({
        status: "pending",
        workflowRunId: "run_previous",
        attempts: 4,
        updatedAt: new Date("2026-08-19T00:00:00.000Z"),
      }) as never,
    )
    const { enqueueStoryPublication } = await import("@/lib/story-publication")

    await expect(enqueueStoryPublication("story_123")).resolves.toBeNull()
    expect(validateStoryPublicationCore).not.toHaveBeenCalled()
  })

  it("backs off retries after a previous dispatch attempt", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z")
    const { isStoryPublicationDispatchDue } = await import(
      "@/lib/story-publication"
    )

    expect(
      isStoryPublicationDispatchDue({
        status: "pending",
        attempts: 2,
        updatedAt: new Date(now.getTime() - 19 * 60 * 1_000),
        now,
      }),
    ).toBe(false)
    expect(
      isStoryPublicationDispatchDue({
        status: "pending",
        attempts: 2,
        updatedAt: new Date(now.getTime() - 20 * 60 * 1_000),
        now,
      }),
    ).toBe(true)
  })
})
