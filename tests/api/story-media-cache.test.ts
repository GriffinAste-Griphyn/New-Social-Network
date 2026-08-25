import { afterEach, describe, expect, it } from "vitest"

const originalEnv = { ...process.env }

describe("private story media cache policy", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("bounds private caching by the signed access lifetime", async () => {
    process.env.AUTH_SECRET = "story-media-cache-test-secret-value"
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test"
    const [
      { createStoryMediaAccessToken },
      { getStoryMediaCacheControl, getStoryMediaCdnCacheControl },
    ] =
      await Promise.all([
        import("@/lib/story-media/access"),
        import("@/lib/story-media/cache-control"),
      ])
    const pathname = "stories/web-direct/creator/story-display.jpg"
    const token = createStoryMediaAccessToken(pathname)
    const request = new Request(
      `https://app.example.com/api/story-media/${pathname}?token=${encodeURIComponent(token)}`,
    )

    const policy = getStoryMediaCacheControl(request, pathname)

    expect(policy).toMatch(/^private, max-age=\d+$/)
    expect(policy).not.toContain("public")
    expect(policy).not.toContain("immutable")
    const maxAge = Number(policy.match(/max-age=(\d+)/)?.[1])
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThanOrEqual(2 * 60 * 60)

    const cdnPolicy = getStoryMediaCdnCacheControl(request, pathname)
    const sharedMaxAge = Number(cdnPolicy.match(/s-maxage=(\d+)/)?.[1])
    expect(cdnPolicy).toMatch(
      /^public, max-age=0, s-maxage=\d+, must-revalidate$/,
    )
    expect(sharedMaxAge).toBeGreaterThan(0)
    expect(sharedMaxAge).toBeLessThan(maxAge)
  })

  it("does not cache unsigned private media", async () => {
    const { getStoryMediaCacheControl, getStoryMediaCdnCacheControl } = await import(
      "@/lib/story-media/cache-control"
    )

    expect(
      getStoryMediaCacheControl(
        new Request("https://app.example.com/api/story-media/example"),
        "stories/web-direct/creator/story-display.jpg",
      ),
    ).toBe("private, no-store")
    expect(
      getStoryMediaCdnCacheControl(
        new Request("https://app.example.com/api/story-media/example"),
        "stories/web-direct/creator/story-display.jpg",
      ),
    ).toBe("no-store")
  })
})
