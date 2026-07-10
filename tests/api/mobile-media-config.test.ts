import { afterEach, describe, expect, it } from "vitest"

import { getMobileMediaConfig } from "@/lib/mobile-media-config"

const originalEnv = { ...process.env }

const mediaConfigEnvironmentNames = [
  "MOBILE_MEDIA_CONFIG_VERSION",
  "MOBILE_IMAGE_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD",
  "MOBILE_STACK_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_STACK_PREHEAT_LIMIT_STANDARD",
  "MOBILE_PREPARED_PLAYER_LIMIT_CONSTRAINED",
  "MOBILE_PREPARED_PLAYER_LIMIT_STANDARD",
  "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_CONSTRAINED",
  "MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD",
] as const

describe("mobile media runtime config", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("defaults to a bounded adjacent-media working set", () => {
    for (const name of mediaConfigEnvironmentNames) {
      delete process.env[name]
    }

    expect(getMobileMediaConfig()).toMatchObject({
      version: "2026-07-10.2",
      imageDerivativeUploadEnabled: false,
      imagePreheatLimit: { constrained: 1, standard: 2 },
      stackPreheatLimit: { constrained: 1, standard: 2 },
      preparedPlayerLimit: { constrained: 0, standard: 0 },
      persistentVideoPreheatLimit: { constrained: 0, standard: 0 },
    })
  })

  it("clamps remotely configured limits to safe bounds", () => {
    process.env.MOBILE_IMAGE_PREHEAT_LIMIT_STANDARD = "999"
    process.env.MOBILE_STACK_PREHEAT_LIMIT_CONSTRAINED = "0"
    process.env.MOBILE_PREPARED_PLAYER_LIMIT_STANDARD = "99"
    process.env.MOBILE_PERSISTENT_VIDEO_PREHEAT_LIMIT_STANDARD = "-5"

    expect(getMobileMediaConfig()).toMatchObject({
      imagePreheatLimit: { standard: 4 },
      stackPreheatLimit: { constrained: 1 },
      preparedPlayerLimit: { standard: 0 },
      persistentVideoPreheatLimit: { standard: 0 },
    })
  })
})
