import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { redisCommand, redisPipeline } from "@/lib/upstash-redis"

describe("Upstash Redis REST requests", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("lets fetch manage connection headers for commands", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ result: "PONG" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(redisCommand<string>(["PING"])).resolves.toBe("PONG")

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(request.headers)
    expect(headers.get("authorization")).toBe("Bearer test-token")
    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.has("connection")).toBe(false)
    expect(headers.has("keep-alive")).toBe(false)
  })

  it("lets fetch manage connection headers for pipelines", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json([{ result: 1 }, { result: 2 }]))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      redisPipeline<number>([
        ["INCR", "one"],
        ["INCR", "two"],
      ]),
    ).resolves.toEqual([1, 2])

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(request.headers)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://redis.example.test/pipeline",
    )
    expect(headers.has("connection")).toBe(false)
    expect(headers.has("keep-alive")).toBe(false)
  })
})
