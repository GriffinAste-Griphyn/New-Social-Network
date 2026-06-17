import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { getSession } from "@/lib/auth"
import { getAdvertiserWorkspaceForUser } from "@/lib/advertiser-store"
import { enforceRequestRateLimits } from "@/lib/request-security"

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")

  return {
    ...actual,
    getSession: vi.fn(),
  }
})

vi.mock("@/lib/advertiser-store", () => ({
  getAdvertiserWorkspaceForUser: vi.fn(),
}))

vi.mock("@/lib/request-security", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/request-security")>(
      "@/lib/request-security",
    )

  return {
    ...actual,
    enforceRequestRateLimits: vi.fn(),
  }
})

const session = {
  id: "advertiser_user_123",
  email: "ads@example.com",
  handle: "ads",
  displayName: "Ads",
  avatarUrl: null,
  onboardingIntent: "create" as const,
  creatorStatus: "inactive" as const,
}

const workspace = {
  account: {
    id: "advertiser_123",
  },
}
const originalEnv = { ...process.env }

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "x-forwarded-for": "203.0.113.41",
    },
    body: JSON.stringify(body),
  })
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe("advertiser Daily creative upload API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.BLOB_READ_WRITE_TOKEN = "blob_rw_token"
    vi.mocked(getSession).mockResolvedValue(session)
    vi.mocked(getAdvertiserWorkspaceForUser).mockResolvedValue(workspace as never)
    vi.mocked(enforceRequestRateLimits).mockResolvedValue(null)
    vi.mocked(generateClientTokenFromReadWriteToken).mockResolvedValue(
      "blob_client_token",
    )
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("prepares a constrained public Daily video upload", async () => {
    const { POST } = await import(
      "@/app/api/advertiser/daily/creative-upload/route"
    )
    const response = await POST(
      jsonRequest("/api/advertiser/daily/creative-upload", {
        assetKind: "video",
        fileName: "launch spot.mp4",
        contentType: "video/mp4",
        byteSize: 4 * 1024 * 1024,
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-m4v"],
        maximumSizeInBytes: 150 * 1024 * 1024,
        allowOverwrite: false,
      }),
    )
    expect(payload).toMatchObject({
      ok: true,
      assetKind: "video",
      clientToken: "blob_client_token",
      contentType: "video/mp4",
      maxSizeBytes: 150 * 1024 * 1024,
    })
    expect(String(payload.pathname)).toMatch(
      /^advertisers\/daily\/videos\/advertiser_123\/.+-launch-spot\.mp4$/,
    )
  })

  it("prepares an optional Daily poster upload", async () => {
    const { POST } = await import(
      "@/app/api/advertiser/daily/creative-upload/route"
    )
    const response = await POST(
      jsonRequest("/api/advertiser/daily/creative-upload", {
        assetKind: "poster",
        fileName: "poster.png",
        contentType: "image/png",
        byteSize: 512 * 1024,
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(200)
    expect(generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
        maximumSizeInBytes: 5 * 1024 * 1024,
      }),
    )
    expect(String(payload.pathname)).toMatch(
      /^advertisers\/daily\/posters\/advertiser_123\/.+-poster\.png$/,
    )
  })

  it("rejects unsupported Daily video creative types", async () => {
    const { POST } = await import(
      "@/app/api/advertiser/daily/creative-upload/route"
    )
    const response = await POST(
      jsonRequest("/api/advertiser/daily/creative-upload", {
        assetKind: "video",
        fileName: "creative.webm",
        contentType: "video/webm",
        byteSize: 1024,
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(400)
    expect(payload.error).toBe("Choose an MP4, MOV, or M4V video up to 150 MB.")
    expect(generateClientTokenFromReadWriteToken).not.toHaveBeenCalled()
  })

  it("requires an advertiser workspace", async () => {
    vi.mocked(getAdvertiserWorkspaceForUser).mockResolvedValueOnce(null)

    const { POST } = await import(
      "@/app/api/advertiser/daily/creative-upload/route"
    )
    const response = await POST(
      jsonRequest("/api/advertiser/daily/creative-upload", {
        assetKind: "video",
        fileName: "launch.mp4",
        contentType: "video/mp4",
        byteSize: 1024,
      }),
    )
    const payload = await responseJson(response)

    expect(response.status).toBe(403)
    expect(payload.error).toBe(
      "Create an advertiser account before uploading Daily creative.",
    )
  })
})
