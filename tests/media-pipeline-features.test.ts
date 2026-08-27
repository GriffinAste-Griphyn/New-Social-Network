import { afterEach, describe, expect, it } from "vitest"

import {
  areDurableMediaWorkersEnabled,
  isAsyncMediaCompletionEnabled,
  isDirectMediaDeliveryEnabled,
  mediaDeliveryAccess,
  minimumAsyncMediaCompletionBuild,
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
})
