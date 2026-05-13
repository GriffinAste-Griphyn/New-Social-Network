import { beforeEach, describe, expect, it, vi } from "vitest"

const normalizedSourceBuffer = Buffer.from("normalized-source")
const normalizedAvatarBuffer = Buffer.from("normalized-avatar")
const sharpToBuffer = vi.fn()

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
    extract() {
      return this
    },
    metadata: vi.fn(async () => ({ width: 512, height: 512 })),
    toBuffer: sharpToBuffer,
  })),
}))

const pngHeader = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])

describe("profile avatar storage", () => {
  beforeEach(() => {
    process.env.STORY_STORAGE_PROVIDER = "vercel-blob"
    sharpToBuffer.mockReset()
    sharpToBuffer.mockResolvedValue(normalizedAvatarBuffer)
  })

  it("stores Vercel Blob avatars privately and returns an app media route", async () => {
    const { put } = await import("@vercel/blob")
    const { saveProfileAvatar } = await import("@/lib/profile-avatar-storage")

    sharpToBuffer
      .mockResolvedValueOnce(normalizedSourceBuffer)
      .mockResolvedValueOnce(normalizedAvatarBuffer)

    vi.mocked(put)
      .mockResolvedValueOnce({
        url: "https://store.private.blob.vercel-storage.com/avatars/source/avatar-source.jpg",
        downloadUrl:
          "https://store.private.blob.vercel-storage.com/avatars/source/avatar-source.jpg",
        pathname: "avatars/source/avatar-source.jpg",
        contentType: "image/jpeg",
        contentDisposition: 'attachment; filename="avatar-source.jpg"',
        etag: "avatar-source-etag",
      })
      .mockResolvedValueOnce({
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

    expect(put).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^avatars\/source\/.+\.jpg$/),
      normalizedSourceBuffer,
      {
        access: "private",
        contentType: "image/jpeg",
      },
    )
    expect(put).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^avatars\/.+\.jpg$/),
      normalizedAvatarBuffer,
      {
        access: "private",
        contentType: "image/jpeg",
      },
    )
    expect(avatar).toMatchObject({
      avatarUrl: "/api/profile-avatar-media/avatars/avatar.jpg",
      sourceUrl: "/api/profile-avatar-media/avatars/source/avatar-source.jpg",
      storageProvider: "vercel-blob",
      storageKey: "avatars/avatar.jpg",
      sourceStorageKey: "avatars/source/avatar-source.jpg",
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
