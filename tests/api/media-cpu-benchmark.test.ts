import { afterEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/cron/media-cpu-benchmark/route"
import { benchmarkMediaImageCpu } from "@/lib/media-image-cpu-benchmark"

vi.mock("@/lib/media-image-cpu-benchmark", () => ({ benchmarkMediaImageCpu: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe("preview CPU benchmark protection", () => {
  it("cannot execute in production even if explicitly enabled", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("MEDIA_CPU_BENCHMARK_ENABLED", "true")
    expect((await POST(new Request("https://app.example/api/cron/media-cpu-benchmark", { method: "POST" }))).status).toBe(404)
    expect(benchmarkMediaImageCpu).not.toHaveBeenCalled()
  })
  it("rejects missing, incorrect, and non-ASCII authorization before doing CPU work", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("MEDIA_CPU_BENCHMARK_ENABLED", "true")
    vi.stubEnv("CRON_SECRET", "test-secret")
    for (const authorization of ["", "Bearer wrong-value", "Bearer tést-secret"]) {
      expect((await POST(new Request("https://app.example/api/cron/media-cpu-benchmark", { method: "POST", headers: { authorization } }))).status).toBe(401)
    }
    expect(benchmarkMediaImageCpu).not.toHaveBeenCalled()
  })
  it("runs only for an enabled preview with valid authorization", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("MEDIA_CPU_BENCHMARK_ENABLED", "true")
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.mocked(benchmarkMediaImageCpu).mockResolvedValue({ fixture: "test", region: "iad1", cpu: 1, sharpConcurrency: 1, rounds: [] })
    const response = await POST(new Request("https://app.example/api/cron/media-cpu-benchmark", { method: "POST", headers: { authorization: "Bearer test-secret" } }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(benchmarkMediaImageCpu).toHaveBeenCalledOnce()
  })
})
