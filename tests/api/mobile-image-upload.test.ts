import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  createCloudflareR2OriginalUpload,
  isCloudflareR2StoryImageStorageEnabled,
} from "@/lib/cloudflare-r2"
import { enforceRequestRateLimits } from "@/lib/request-security"

vi.mock("@/lib/auth", () => ({ getCompleteMobileSession: vi.fn() }))
vi.mock("@/lib/cloudflare-r2", () => ({
  createCloudflareR2OriginalUpload: vi.fn(),
  isCloudflareR2StoryImageStorageEnabled: vi.fn(),
  minimumCloudflareR2ImageBuild: 400,
}))
vi.mock("@/lib/request-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/request-security")>(
    "@/lib/request-security",
  )
  return { ...actual, enforceRequestRateLimits: vi.fn() }
})

const session = {
  id: "creator_123",
  email: "creator@example.com",
  handle: "creator",
  displayName: "Creator",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "active" as const,
}

const originalEnv = { ...process.env }

function uploadRequest(build: number) {
  return new Request("https://app.example.com/api/mobile/stories/image-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ubeye-app-build": String(build),
    },
    body: JSON.stringify({
      fileName: "story.jpg",
      contentType: "image/jpeg",
      byteSize: 2_048,
      displayContentType: "image/avif",
    }),
  })
}

describe("mobile image upload preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.VERCEL_BLOB_SUSPENDED_MODE = "true"
    vi.mocked(getCompleteMobileSession).mockResolvedValue(session)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(isCloudflareR2StoryImageStorageEnabled).mockReturnValue(true)
    vi.mocked(createCloudflareR2OriginalUpload).mockResolvedValue({
      key: "stories/web-direct/creator_123/source.jpg",
      uploadUrl: "https://account.r2.cloudflarestorage.com/originals/source.jpg?signature=test",
      expiresInSeconds: 900,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns a direct R2 PUT target to build 400 and newer", async () => {
    const { POST } = await import("@/app/api/mobile/stories/image-upload/route")
    const response = await POST(uploadRequest(400))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      storageProvider: "cloudflare-r2",
      source: {
        provider: "cloudflare-r2",
        clientToken: "",
        contentType: "image/jpeg",
      },
      display: null,
      thumbnail: null,
    })
  })

  it("requires an R2-capable app build", async () => {
    const { POST } = await import("@/app/api/mobile/stories/image-upload/route")
    const response = await POST(uploadRequest(399))

    expect(response.status).toBe(426)
    expect(response.headers.get("upgrade")).toBe("UBEYE/400")
  })
})
