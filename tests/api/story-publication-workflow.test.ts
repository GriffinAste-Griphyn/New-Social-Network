import { beforeEach, describe, expect, it, vi } from "vitest"

import { createHook } from "workflow"
import {
  completeStoryPublicationStep,
  failStoryPublicationStep,
  fanoutStoryPublicationStep,
  invalidateStoryPublicationSnapshotsStep,
  notifyStoryPublicationStep,
  processStoryPublicationEarningsStep,
  validateStoryPublicationStep,
} from "@/workflows/story-publication/steps"

vi.mock("workflow", () => ({ createHook: vi.fn() }))
vi.mock("@/workflows/story-publication/steps", () => ({
  completeStoryPublicationStep: vi.fn(),
  failStoryPublicationStep: vi.fn(),
  fanoutStoryPublicationStep: vi.fn(),
  invalidateStoryPublicationSnapshotsStep: vi.fn(),
  notifyStoryPublicationStep: vi.fn(),
  processStoryPublicationEarningsStep: vi.fn(),
  validateStoryPublicationStep: vi.fn(),
}))

function hook(conflict: { runId: string } | null = null) {
  return {
    getConflict: vi.fn().mockResolvedValue(conflict),
    [Symbol.dispose]: vi.fn(),
  }
}

describe("story publication workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createHook).mockReturnValue(hook() as never)
    vi.mocked(validateStoryPublicationStep).mockResolvedValue({
      storyId: "story_123",
      creatorId: "creator_123",
      creatorName: "Creator",
      caption: "Hello",
      createdAt: new Date(),
    })
  })

  it("runs every durable publication effect and records completion", async () => {
    const { publishStoryWorkflow } = await import(
      "@/workflows/story-publication"
    )

    await expect(publishStoryWorkflow("story_123")).resolves.toEqual({
      status: "completed",
    })
    expect(processStoryPublicationEarningsStep).toHaveBeenCalledWith("story_123")
    expect(fanoutStoryPublicationStep).toHaveBeenCalledWith("story_123")
    expect(notifyStoryPublicationStep).toHaveBeenCalledWith("story_123")
    expect(invalidateStoryPublicationSnapshotsStep).toHaveBeenCalledWith(
      "story_123",
    )
    expect(completeStoryPublicationStep).toHaveBeenCalledWith("story_123")
  })

  it("deduplicates an already active story publication", async () => {
    vi.mocked(createHook).mockReturnValue(
      hook({ runId: "run_existing" }) as never,
    )
    const { publishStoryWorkflow } = await import(
      "@/workflows/story-publication"
    )

    await expect(publishStoryWorkflow("story_123")).resolves.toEqual({
      status: "deduplicated",
      runId: "run_existing",
    })
    expect(validateStoryPublicationStep).not.toHaveBeenCalled()
  })

  it("records a failed effect before allowing the run to retry", async () => {
    vi.mocked(fanoutStoryPublicationStep).mockRejectedValue(
      new Error("redis unavailable"),
    )
    const { publishStoryWorkflow } = await import(
      "@/workflows/story-publication"
    )

    await expect(publishStoryWorkflow("story_123")).rejects.toThrow(
      "redis unavailable",
    )
    expect(failStoryPublicationStep).toHaveBeenCalledWith(
      "story_123",
      "redis unavailable",
    )
    expect(notifyStoryPublicationStep).toHaveBeenCalledWith("story_123")
  })
})
