import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStoryMediaAccessToken } from "@/lib/story-media/access"

vi.mock("@/lib/auth", () => ({ getMobileSession: vi.fn().mockResolvedValue(null), getSession: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/db", () => ({ getDb: () => {
  const query = { select: () => query, from: () => query, innerJoin: () => query, where: () => query, limit: async () => [] }
  return query
} }))
vi.mock("@/lib/story-storage", async () => ({
  ...await vi.importActual<typeof import("@/lib/story-storage")>("@/lib/story-storage"),
  createCloudflareStreamPlaybackUrl: vi.fn().mockResolvedValue("https://customer.example.cloudflarestream.com/signed/manifest/video.m3u8"),
}))

const pathname = "cloudflare-stream/0123456789abcdef0123456789abcdef/manifest/video.m3u8"
const context = { params: Promise.resolve({ pathname: pathname.split("/") }) }
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=240x426\n../240/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1080x1920\n../1080/video.m3u8\n'

describe("authenticated exact rendition route", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test")
    vi.stubEnv("AUTH_SECRET", "rendition-route-test-secret-at-least-32-characters")
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it("returns one selected rendition through the existing signed authorization boundary", async () => {
    const { GET } = await import("@/app/api/story-media/[...pathname]/route")
    const fetcher = vi.fn().mockResolvedValue(new Response(master))
    vi.stubGlobal("fetch", fetcher)
    const token = createStoryMediaAccessToken(pathname)
    const response = await GET(new Request(`https://www.ubeye.ai/api/story-media/${pathname}?token=${token}&selection=exact-v1&rendition=1080`), context)
    expect(response.status).toBe(200)
    expect(response.headers.get("x-ubeye-rendition")).toBe("1080x1920")
    expect(await response.text()).not.toContain("/240/")
  })
  it("keeps the legacy adaptive redirect and does not fetch the provider master", async () => {
    const { GET } = await import("@/app/api/story-media/[...pathname]/route")
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const token = createStoryMediaAccessToken(pathname)
    const response = await GET(new Request(`https://www.ubeye.ai/api/story-media/${pathname}?token=${token}&selection=exact-v1`), context)
    expect(response.status).toBe(302)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("fails explicitly rather than presenting an adaptive response as selected HD", async () => {
    const { GET } = await import("@/app/api/story-media/[...pathname]/route")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const token = createStoryMediaAccessToken(pathname)
    const response = await GET(new Request(`https://www.ubeye.ai/api/story-media/${pathname}?token=${token}&rendition=1080`), context)
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("does not let the rendition parameter bypass authentication", async () => {
    const { GET } = await import("@/app/api/story-media/[...pathname]/route")
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const response = await GET(new Request(`https://www.ubeye.ai/api/story-media/${pathname}?rendition=1080&token=invalid`), context)
    expect(response.status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
