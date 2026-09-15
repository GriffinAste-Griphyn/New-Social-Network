import { afterEach, describe, expect, it, vi } from "vitest"
import { after } from "next/server"
import { dispatchMediaTask } from "@/lib/media-dispatch"

vi.mock("next/server", () => ({ after: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe("durable media dispatch fallback", () => {
  it("preserves the accepted task when Workflow transport fails", async () => {
    vi.stubEnv("MEDIA_WORKFLOW_DISPATCH_ENABLED", "true")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const runDirect = vi.fn().mockResolvedValue(undefined)
    const result = await dispatchMediaTask({ label: "image", identity: "job-1", startDurable: vi.fn().mockRejectedValue(new Error("transport unavailable")), runDirect })
    expect(result).toBeNull()
    expect(runDirect).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)()
    expect(runDirect).toHaveBeenCalledOnce()
  })
  it("does not run a duplicate direct task after successful durable dispatch", async () => {
    vi.stubEnv("MEDIA_WORKFLOW_DISPATCH_ENABLED", "true")
    const runDirect = vi.fn()
    await expect(dispatchMediaTask({ label: "video", identity: "job-1", startDurable: async () => ({ runId: "run-1" }), runDirect })).resolves.toEqual({ runId: "run-1" })
    expect(after).not.toHaveBeenCalled()
    expect(runDirect).not.toHaveBeenCalled()
  })
})
