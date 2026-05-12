import { beforeEach, describe, expect, it, vi } from "vitest"

const normalizedAvatarBuffer = Buffer.from("normalized-avatar")

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}))

vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    rotate() {
      return this
    },
    resize() {
      return this
    },
    jpeg() {
      return this
    },
    toBuffer: vi.fn(async () => normalizedAvatarBuffer),
  })),
}))

const pngHeader = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])

describe("profile avatar storage", () => {
  beforeEach(() => {
    process.env.STORY_STORAGE_PROVIDER = "vercel-blob"
  })

  it("stores Vercel Blob avatars privately and returns an app media route", async () => {
    const { put } = await import("@vercel/blob")
    const { saveProfileAvatar } = await import("@/lib/profile-avatar-storage")

    vi.mocked(put).mockResolvedValue({
      url: "https://store.private.blob.vercel-storage.com/avatars/avatar.jpg",
      downloadUrl:
        "https://store.private.blob.vercel-storage.com/avatars/avatar.jpg",
      pathname: "avatars/avatar.jpg",
      contentType: "image/jpeg",
      contentDisposition: 'attachment; filename="avatar.jpg"',
      etag: "avatar-etag",
    })

    const avatar = await saveProfileAvatar(
      new File([pngHeader], "avatar.png", { type: "image/png" }),
    )

    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^avatars\/.+\.jpg$/),
      normalizedAvatarBuffer,
      {
        access: "private",
        contentType: "image/jpeg",
      },
    )
    expect(avatar).toMatchObject({
      avatarUrl: "/api/profile-avatar-media/avatars/avatar.jpg",
      storageProvider: "vercel-blob",
      storageKey: "avatars/avatar.jpg",
    })
  })

  it("rewrites private Blob URLs to absolute app media URLs", async () => {
    const { publicProfileAvatarUrl } = await import("@/lib/profile-avatar-storage")
    const request = new Request("https://app.example.com/api/mobile/feed")

    expect(
      publicProfileAvatarUrl(
        "https://store.private.blob.vercel-storage.com/avatars/avatar.jpg",
        request,
      ),
    ).toBe("https://app.example.com/api/profile-avatar-media/avatars/avatar.jpg")
  })

  it("returns 404 when a private avatar blob is missing", async () => {
    const { head } = await import("@vercel/blob")
    const { GET } = await import("@/app/api/profile-avatar-media/[...pathname]/route")

    vi.mocked(head).mockRejectedValue(
      new Error("Vercel Blob: The requested blob does not exist"),
    )

    const response = await GET(new Request("https://app.example.com/avatar"), {
      params: Promise.resolve({ pathname: ["avatars", "missing.jpg"] }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Profile photo not found.",
    })
  })
})
