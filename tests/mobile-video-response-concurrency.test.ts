import { describe, expect, it, vi } from "vitest"
import { getExistingMobileVideoStoryCompletion } from "@/lib/stories/mobile-video-completion"
import { getStoryByStoredAssetForOwner, getStoryTextOverlaysForOwner, getStoryUploadStatusForOwner } from "@/lib/story-store"

vi.mock("@/lib/story-store", () => ({ createStory: vi.fn(), getStoryByStoredAssetForOwner: vi.fn(), getStoryTextOverlaysForOwner: vi.fn(), getStoryUploadStatusForOwner: vi.fn() }))
vi.mock("@/lib/story-storage", () => ({ publicStoryMediaUrl: (url: string | null) => url }))

describe("owner-bound video completion response", () => {
  it("keeps a ready private Cloudflare draft pending until publication is confirmed", async () => {
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValue({ id: "draft", assetKind: "video", mediaUrl: "/video",
      thumbnailUrl: null, processingStatus: "ready", storageProvider: "cloudflare-stream" } as never)
    vi.mocked(getStoryUploadStatusForOwner).mockResolvedValue({ processingStatus: "ready", moderationStatus: "approved", isLive: false } as never)
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([])
    await expect(getExistingMobileVideoStoryCompletion({ request: new Request("https://ubeye.ai"), session: { id: "owner" } as never,
      storageProvider: "cloudflare-stream", storageKey: "uid" }))
      .resolves.toMatchObject({ processingStatus: "processing", asset: { renditions: { playback: { processingStatus: "ready" } } } })
  })
  it("starts independent status and overlay reads together and retains the owner boundary", async () => {
    vi.mocked(getStoryByStoredAssetForOwner).mockResolvedValue({ id: "story", assetKind: "video", mediaUrl: "/video", thumbnailUrl: null, processingStatus: "processing" } as never)
    let resolveStatus!: (value: never) => void
    vi.mocked(getStoryUploadStatusForOwner).mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }))
    vi.mocked(getStoryTextOverlaysForOwner).mockResolvedValue([])
    const session = { id: "owner" } as never
    const pending = getExistingMobileVideoStoryCompletion({ request: new Request("https://ubeye.ai"), session, storageProvider: "cloudflare-stream", storageKey: "uid" })
    await vi.waitFor(() => expect(getStoryTextOverlaysForOwner).toHaveBeenCalledWith("story", "owner"))
    expect(getStoryUploadStatusForOwner).toHaveBeenCalledWith("story", "owner", { refreshProvider: false })
    resolveStatus({ processingStatus: "processing", moderationStatus: "pending" } as never)
    await expect(pending).resolves.toMatchObject({ storyId: "story", completionState: "reused", processingStatus: "processing", moderationStatus: "pending", textOverlays: [] })
  })
})
