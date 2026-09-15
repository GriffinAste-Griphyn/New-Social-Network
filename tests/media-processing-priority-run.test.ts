import { beforeEach, describe, expect, it, vi } from "vitest"
import { getTableName, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { mediaEncoderVersion, selectRenditionProfiles } from "@/lib/media-pipeline/contracts"
import { processMediaJobRun } from "@/lib/media-pipeline/direct-processing"
import { encodeMediaRenditionStep } from "@/workflows/media-processing/steps"

const source = { width: 1080, height: 1920, durationMs: 10000, frameRate: 30, videoCodec: "h264", audioCodec: null, hasAudio: false, rotation: 0 }
const state = vi.hoisted(() => ({
  job: {} as Record<string, unknown>, asset: {} as Record<string, unknown>,
  ready: new Set<string>(), published: new Set<string>(),
}))

vi.mock("@/lib/db", () => ({ getDb: () => ({
  select: () => {
    let tableName = ""
    const read = () => tableName === "media_processing_jobs" ? [{ ...state.job, ready: state.asset.processingStatus }] :
      tableName === "media_assets" ? [{ ...state.asset }] : [
        { kind: "poster", label: "1080x1920" },
        ...[...state.ready].map((label) => ({ kind: "hls-variant", label })),
        { kind: "hls-master", label: "adaptive", qualityDetails: { renditionLabels: [...state.published] } },
      ]
    const chain = {
      from: (table: Parameters<typeof getTableName>[0]) => { tableName = getTableName(table); return chain },
      leftJoin: () => chain, where: () => chain, limit: async () => read(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve),
    }
    return chain
  },
  update: (table: Parameters<typeof getTableName>[0]) => {
    let values: Record<string, unknown> = {}, condition: SQL, executed = false, result: unknown[] = []
    const commit = () => {
      if (executed) return result
      executed = true
      const isJob = getTableName(table) === "media_processing_jobs"
      const params = new PgDialect().sqlToQuery(condition).params
      if (isJob && params.length >= 3 && (!params.includes(state.job.status) || !params.includes(state.job.attempts))) return []
      Object.assign(isJob ? state.job : state.asset, values)
      result = [{ id: isJob ? state.job.id : "asset-1" }]
      return result
    }
    const chain = {
      set: (input: Record<string, unknown>) => { values = input; return chain },
      where: (input: SQL) => { condition = input; return chain },
      returning: async () => commit(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(commit()).then(resolve),
    }
    return chain
  },
}) }))

vi.mock("@/workflows/media-processing/steps", () => ({
  inspectMediaSourceStep: vi.fn(async () => ({ source, profiles: selectRenditionProfiles(source) })),
  generateMediaPosterStep: vi.fn(async () => ({})),
  encodeMediaAudioRenditionStep: vi.fn(async () => null),
  encodeMediaRenditionStep: vi.fn(async (_id: string, profile: { label: string }) => { state.ready.add(profile.label); return { label: profile.label } }),
  publishMasterPlaylistStep: vi.fn(async (_id: string, renditions: Array<{ label: string }>) => { state.published = new Set(renditions.map((r) => r.label)); return {} }),
  activatePlayableMediaProcessingStep: vi.fn(async () => { state.asset.processingStatus = "ready" }),
  completeMediaProcessingStep: vi.fn(async () => { state.job.status = "ready"; state.asset.processingStatus = "ready" }),
  failMediaProcessingStep: vi.fn(async () => { state.job.status = "error" }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.job = { id: "media-job-1", mediaAssetId: "asset-1", status: "pending", attempts: 0, progressPct: 0, updatedAt: new Date(), sourceMetadata: source, encoderVersion: mediaEncoderVersion, outputPrefix: "delivery/test", startedAt: null }
  state.asset = { processingStatus: "processing", providerPctComplete: 0 }
  state.ready.clear(); state.published.clear()
})

describe("priority execution against the durable job state", () => {
  it("yields after first publication and finishes enhancements without spending an error retry", async () => {
    expect(await processMediaJobRun("media-job-1", { stopAfterPlayable: true })).toMatchObject({ status: "yielded", slices: 2 })
    expect([...state.ready]).toEqual(["540p"])
    expect(state.asset.processingStatus).toBe("ready")
    expect(state.job).toMatchObject({ status: "pending", attempts: 0 })
    expect(await processMediaJobRun("media-job-1")).toMatchObject({ status: "completed" })
    expect(state.job).toMatchObject({ status: "ready", attempts: 1 })
    expect([...state.ready].sort()).toEqual(["1080p", "360p", "540p", "720p"])
  })
  it("does not encode again for a duplicate delivery with a live database claim", async () => {
    state.job.status = "encoding"; state.job.attempts = 1
    expect(await processMediaJobRun("media-job-1")).toMatchObject({ status: "already_running" })
    expect(encodeMediaRenditionStep).not.toHaveBeenCalled()
    expect(state.job.attempts).toBe(1)
  })
  it("continues budget yields but preserves the attempt count of actual errors", async () => {
    expect(await processMediaJobRun("media-job-1", { maximumSlices: 1 })).toMatchObject({ status: "yielded" })
    expect(state.job.attempts).toBe(0)
    vi.mocked(encodeMediaRenditionStep).mockRejectedValueOnce(new Error("encoder interrupted"))
    await expect(processMediaJobRun("media-job-1")).rejects.toThrow("encoder interrupted")
    expect(state.job).toMatchObject({ status: "error", attempts: 1 })
  })
})
