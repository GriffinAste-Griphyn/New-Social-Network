import { afterEach, describe, expect, it, vi } from "vitest"

import { isPubliclyHiddenProfile } from "@/lib/public-account-visibility"

describe("isPubliclyHiddenProfile", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("hides the App Review profile from public discovery surfaces", () => {
    expect(
      isPubliclyHiddenProfile({
        email: "griffin.aste+appreview@gmail.com",
        handle: "ubeye_app_review",
        displayName: "UBEYE App Review",
      }),
    ).toBe(true)
  })

  it("normalizes handles and names when checking hidden profiles", () => {
    expect(
      isPubliclyHiddenProfile({
        handle: "@AppReview",
        displayName: "Not Review",
      }),
    ).toBe(true)
    expect(
      isPubliclyHiddenProfile({
        handle: "normaluser",
        displayName: "  UBEYE App Review  ",
      }),
    ).toBe(true)
  })

  it("supports deploy-time hidden profile overrides", () => {
    vi.stubEnv("HIDDEN_PUBLIC_PROFILE_EMAILS", "hidden@example.com")
    vi.stubEnv("HIDDEN_PUBLIC_PROFILE_HANDLES", "privateqa")
    vi.stubEnv("HIDDEN_PUBLIC_PROFILE_NAMES", "QA Reviewer")

    expect(isPubliclyHiddenProfile({ email: "hidden@example.com" })).toBe(true)
    expect(isPubliclyHiddenProfile({ handle: "@privateqa" })).toBe(true)
    expect(isPubliclyHiddenProfile({ displayName: "qa reviewer" })).toBe(true)
  })

  it("does not hide normal public profiles", () => {
    expect(
      isPubliclyHiddenProfile({
        email: "creator@example.com",
        handle: "creator",
        displayName: "Creator",
      }),
    ).toBe(false)
  })
})
