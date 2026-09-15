import { describe, expect, it, vi } from "vitest"
import { timeMediaCompletion } from "@/lib/media-completion-timing"

describe("completion tracing", () => {
  it("records a failed phase and preserves its original error", async () => {
    const observe = vi.fn(), error = new Error("claim rejected")
    await expect(timeMediaCompletion("upload_claim", async () => { throw error }, observe)).rejects.toBe(error)
    expect(observe).toHaveBeenCalledWith("upload_claim", expect.any(Number))
  })
  it("cannot change completion when a trace sink throws", async () => {
    await expect(timeMediaCompletion("moderation", async () => "held", () => { throw Error("sink") })).resolves.toBe("held")
  })
})
