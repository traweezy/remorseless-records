import { describe, expect, it } from "vitest"

import {
  getStorefrontRuntimeIdentity,
  resolveStorefrontCommitSha,
} from "./runtime-identity"

describe("storefront runtime identity", () => {
  it("prefers an explicit accepted commit SHA", () => {
    const explicit = "a".repeat(40)
    const railway = "b".repeat(40)

    expect(
      resolveStorefrontCommitSha({
        COMMIT_SHA: explicit,
        RAILWAY_GIT_COMMIT_SHA: railway,
      })
    ).toBe(explicit)
  })

  it("uses Railway's immutable source SHA without a duplicate variable", () => {
    const railway = "C".repeat(40)

    expect(
      getStorefrontRuntimeIdentity({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "staging",
        RAILWAY_GIT_COMMIT_SHA: railway,
      })
    ).toEqual({
      commit_sha: railway.toLowerCase(),
      environment: "staging",
      service: "storefront",
    })
  })

  it("rejects malformed deployment metadata", () => {
    expect(
      getStorefrontRuntimeIdentity({
        COMMIT_SHA: "not-a-sha",
        RAILWAY_ENVIRONMENT_NAME: "private value with spaces",
      })
    ).toEqual({
      commit_sha: "unknown",
      environment: "unknown",
      service: "storefront",
    })
  })
})
