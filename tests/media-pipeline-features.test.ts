import { afterEach, describe, expect, it } from "vitest"

import {
  areDurableMediaWorkersEnabled,
  isAsyncMediaCompletionEnabled,
  isDirectMediaDeliveryEnabled,
  mediaDeliveryAccess,
  minimumAsyncMediaCompletionBuild,
  minimumVercelHlsUploadBuild,
  supportsVercelHlsUpload,
} from "@/lib/media-pipeline/features"

const originalAsyncCompletion = process.env.MEDIA_ASYNC_COMPLETION_ENABLED
const originalDeliveryAccess = process.env.MEDIA_DELIVERY_ACCESS

afterEach(() => {
  if (originalAsyncCompletion === undefined) {
    delete process.env.MEDIA_ASYNC_COMPLETION_ENABLED
  } else {
    process.env.MEDIA_ASYNC_COMPLETION_ENABLED = originalAsyncCompletion
  }
  if (originalDeliveryAccess === undefined) {
    delete process.env.MEDIA_DELIVERY_ACCESS
  } else {
    process.env.MEDIA_DELIVERY_ACCESS = originalDeliveryAccess
  }
})

describe("media pipeline rollout features", () => {
  it("only enables asynchronous completion for compatible clients", () => {
    expect(isAsyncMediaCompletionEnabled(minimumAsyncMediaCompletionBuild - 1))
      .toBe(false)
    expect(isAsyncMediaCompletionEnabled(minimumAsyncMediaCompletionBuild))
      .toBe(true)
    expect(areDurableMediaWorkersEnabled()).toBe(true)
    process.env.MEDIA_ASYNC_COMPLETION_ENABLED = "false"
    expect(isAsyncMediaCompletionEnabled(minimumAsyncMediaCompletionBuild))
      .toBe(false)
    expect(areDurableMediaWorkersEnabled()).toBe(false)
  })

  it("keeps private delivery as the fail-safe default", () => {
    delete process.env.MEDIA_DELIVERY_ACCESS
    expect(mediaDeliveryAccess()).toBe("private")
    expect(isDirectMediaDeliveryEnabled()).toBe(false)
    process.env.MEDIA_DELIVERY_ACCESS = "public"
    expect(mediaDeliveryAccess()).toBe("public")
    expect(isDirectMediaDeliveryEnabled()).toBe(true)
  })

  it("only assigns Vercel uploads to clients that advertise the protocol", () => {
    expect(
      supportsVercelHlsUpload(minimumVercelHlsUploadBuild, "hls-v2"),
    ).toBe(true)
    expect(supportsVercelHlsUpload(389, "hls-v4")).toBe(true)
    expect(
      supportsVercelHlsUpload(minimumVercelHlsUploadBuild - 1, "hls-v4"),
    ).toBe(false)
    expect(supportsVercelHlsUpload(389, null)).toBe(false)
    expect(supportsVercelHlsUpload(389, "hls-v1")).toBe(false)
  })
})
