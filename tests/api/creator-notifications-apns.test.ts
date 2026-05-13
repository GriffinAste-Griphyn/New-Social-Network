import { EventEmitter } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/db"
import { getBlockedPeerIds } from "@/lib/social-safety"

const requestCalls: Array<{
  headers: Record<string, unknown>
  body: string
  host: string
}> = []

vi.mock("node:http2", async () => {
  const actual = await vi.importActual<typeof import("node:http2")>("node:http2")

  return {
    ...actual,
    connect: vi.fn((host: string) => ({
      once: vi.fn(),
      close: vi.fn(),
      request: vi.fn((headers: Record<string, unknown>) => {
        const stream = new EventEmitter() as EventEmitter & {
          setEncoding: ReturnType<typeof vi.fn>
          end: (body: string) => void
          resume: ReturnType<typeof vi.fn>
        }

        stream.setEncoding = vi.fn()
        stream.resume = vi.fn()
        stream.end = (body: string) => {
          requestCalls.push({ headers, body, host })
          queueMicrotask(() => {
            stream.emit("response", { ":status": 200 })
            stream.emit("end")
          })
        }

        return stream
      }),
    })),
  }
})

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
}))

vi.mock("@/lib/social-safety", () => ({
  assertUsersCanConnect: vi.fn(),
  getBlockedPeerIds: vi.fn(),
  isBlockedBetween: vi.fn(),
}))

function mockSelectResults(results: unknown[][]) {
  let callIndex = 0

  vi.mocked(getDb).mockReturnValue({
    select: vi.fn(() => {
      const result = results[callIndex] ?? []
      callIndex += 1

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(result)),
        })),
      }
    }),
  } as never)
}

describe("APNs creator notifications", () => {
  beforeEach(() => {
    vi.resetModules()
    requestCalls.length = 0
    process.env.DATABASE_URL = "postgres://user:pass@example.com/db"
    process.env.AUTH_SECRET = "x".repeat(32)
    process.env.APNS_KEY_ID = "ABC123DEFG"
    process.env.APNS_TEAM_ID = "TEAM123456"
    process.env.APNS_BUNDLE_ID = "com.griffinaste.ubeye"
    process.env.APNS_PRIVATE_KEY = [
      "-----BEGIN PRIVATE KEY-----",
      "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg6fhqVMTpzsBFaFdz",
      "0LhVqokkIgn9vD4BYRpp6hW+pAGhRANCAAT0QH5NgEn/u7xo7EHD0tGqah+8+Eyk",
      "g86zLa518Bw/B2x7k/kdnAExDgq/rnF2jP0xh7/hGIJjLNJ3UlJmLqAq",
      "-----END PRIVATE KEY-----",
    ].join("\\n")
    process.env.APNS_ENVIRONMENT = "sandbox"
    vi.mocked(getBlockedPeerIds).mockResolvedValue(new Set())
  })

  it("sends native APNs notifications for APNs tokens", async () => {
    mockSelectResults([
      [{ subscriberId: "subscriber_1" }],
      [
        {
          expoPushToken: `apns:${"a".repeat(64)}`,
          apnsDeviceToken: "a".repeat(64),
          pushProvider: "apns",
          apnsEnvironment: "sandbox",
        },
      ],
    ])

    const { notifyCreatorStoryPosted } = await import(
      "@/lib/creator-notifications"
    )

    await notifyCreatorStoryPosted({
      creatorId: "creator_1",
      creatorName: "Creator",
      storyId: "story_1",
      caption: "New story",
    })

    expect(requestCalls).toHaveLength(1)
    expect(requestCalls[0]).toMatchObject({
      host: "https://api.sandbox.push.apple.com",
      headers: {
        ":method": "POST",
        ":path": `/3/device/${"a".repeat(64)}`,
        "apns-topic": "com.griffinaste.ubeye",
        "apns-push-type": "alert",
      },
    })
    expect(JSON.parse(requestCalls[0].body)).toMatchObject({
      aps: {
        alert: {
          title: "Creator posted a story",
          body: "New story",
        },
        sound: "default",
      },
      type: "creator_story_posted",
      creatorId: "creator_1",
      storyId: "story_1",
    })
  })
})
