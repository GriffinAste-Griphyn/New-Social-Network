import { describe, expect, it } from "vitest"
import { validDeliveryPair } from "@/lib/media-delivery-observations"
import { selectVerifiedDeliveryCandidate, experimentalRenditionArguments } from "@/lib/media-pipeline/encoding-experiments"
import { mediaRenditionProfiles } from "@/lib/media-pipeline/contracts"

describe("cross-device delivery evidence", () => {
  const pair = { owner: "creator", viewer: "viewer", ownerInstallation: "one", viewerInstallation: "two", acceptedAt: 1000, observedAt: 2000 }
  it("requires a different account and installation and valid server receipt ordering", () => {
    expect(validDeliveryPair(pair)).toBe(true)
    expect(validDeliveryPair({ ...pair, viewer: pair.owner })).toBe(false)
    expect(validDeliveryPair({ ...pair, viewerInstallation: pair.ownerInstallation })).toBe(false)
    expect(validDeliveryPair({ ...pair, ownerInstallation: null })).toBe(false)
    expect(validDeliveryPair({ ...pair, observedAt: 999 })).toBe(false)
    expect(validDeliveryPair({ ...pair, observedAt: Infinity })).toBe(false)
  })
})
describe("offline delivery quality gate", () => {
  const baseline = { name: "base", codec: "h264" as const, bytes: 1000, encodingMs: 1000, ssim: .99, vmaf: 95, valid: true }
  it("retains baseline for unmeasured, degraded, slow or insignificant candidates", () => {
    for (const change of [{ ssim: null }, { ssim: .95 }, { vmaf: null }, { vmaf: 85 }, { bytes: 950 }, { encodingMs: 5000 }, { valid: false }]) {
      expect(selectVerifiedDeliveryCandidate(baseline, [{ ...baseline, name: "candidate", bytes: 500, ...change }])).toBe(baseline)
    }
    expect(selectVerifiedDeliveryCandidate(baseline, [{ ...baseline, name: "verified", bytes: 700 }]).name).toBe("verified")
  })
  it("uses HEVC signalling without AVC profile or level flags", () => {
    const args = experimentalRenditionArguments({ profile: mediaRenditionProfiles[1], outputDirectory: "/tmp/test" }, "hevc")
    expect(args).toContain("libx265"); expect(args).toContain("hvc1")
    expect(args).not.toContain("-x264-params"); expect(args).not.toContain("-level:v")
    expect(args[args.indexOf("-profile:v") + 1]).toBe("main")
  })
})
