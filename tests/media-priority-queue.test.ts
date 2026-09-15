import { afterEach, describe, expect, it, vi } from "vitest"
import { after } from "next/server"
import { send } from "@vercel/queue"
import { dispatchMediaTask } from "@/lib/media-dispatch"
import { consumeMediaQueueJob, InvalidMediaQueueMessage, mediaQueueRetry, sendMediaQueueJob } from "@/lib/media-priority-queue"

vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/media-worker-capacity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-worker-capacity")>("@/lib/media-worker-capacity")
  return { ...actual, withMediaWorkerSlot: async (_lane: string, run: () => Promise<unknown>) => run() }
})
vi.mock("@vercel/queue", () => ({ send: vi.fn().mockResolvedValue({ messageId: "message-1" }) }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe("priority media delivery", () => {
  it("uses independent topics and permits legitimate continuations of the same job", async () => {
    await sendMediaQueueJob("videoInitial", "media-job-1")
    await sendMediaQueueJob("videoEnhancement", "media-job-1")
    await sendMediaQueueJob("imageInitial", "image-job-1")
    expect(vi.mocked(send).mock.calls.map(([topic]) => topic)).toEqual([
      "media-video-first-playable", "media-video-enhancement", "media-image-first-playable",
    ])
    expect(send).toHaveBeenCalledWith("media-video-first-playable", expect.objectContaining({ version: 1, jobId: "media-job-1" }), {
      region: "iad1", retentionSeconds: 86400,
    })
  })
  it("does not dispatch a duplicate after Queue acceptance", async () => {
    vi.stubEnv("MEDIA_WORKFLOW_DISPATCH_ENABLED", "true")
    const startDurable = vi.fn(), runDirect = vi.fn()
    await dispatchMediaTask({ label: "image", identity: "image-job-1", startQueue: async () => true, startDurable, runDirect })
    expect(startDurable).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
  it("keeps direct recovery when both Queue and Workflow transports fail", async () => {
    vi.stubEnv("MEDIA_WORKFLOW_DISPATCH_ENABLED", "true")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const runDirect = vi.fn().mockResolvedValue(null)
    await dispatchMediaTask({ label: "video", identity: "media-job-1", startQueue: async () => { throw new Error("queue down") }, startDurable: async () => { throw new Error("workflow down") }, runDirect })
    expect(after).toHaveBeenCalledOnce()
    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)()
    expect(runDirect).toHaveBeenCalledOnce()
  })
  it("acks malformed and wrong-lane messages without running a worker", async () => {
    const process = vi.fn()
    await expect(consumeMediaQueueJob("imageInitial", { version: 1, jobId: "media-job-1", enqueuedAt: 1 }, process)).rejects.toBeInstanceOf(InvalidMediaQueueMessage)
    await expect(consumeMediaQueueJob("videoInitial", { version: 2, jobId: "media-job-1", enqueuedAt: 1 }, process)).rejects.toBeInstanceOf(InvalidMediaQueueMessage)
    expect(process).not.toHaveBeenCalled()
    expect(mediaQueueRetry(new InvalidMediaQueueMessage(), { deliveryCount: 1 })).toEqual({ acknowledge: true })
  })
  it("preserves retry on worker failure and bounds retry delay", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const error = new Error("transient processing failure")
    await expect(consumeMediaQueueJob("videoInitial", { version: 1, jobId: "media-job-1", enqueuedAt: Date.now() }, async () => { throw error })).rejects.toBe(error)
    expect(mediaQueueRetry(error, { deliveryCount: 1 })).toEqual({ afterSeconds: 30 })
    expect(mediaQueueRetry(error, { deliveryCount: 100 })).toEqual({ afterSeconds: 300 })
  })
})
