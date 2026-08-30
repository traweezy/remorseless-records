import {
  getBackendRuntimeIdentity,
  resolveBackendCommitSha,
} from "./runtime-identity"

describe("backend runtime identity", () => {
  it("prefers an explicit accepted commit SHA", () => {
    const explicit = "a".repeat(40)
    const railway = "b".repeat(40)

    expect(
      resolveBackendCommitSha({
        COMMIT_SHA: explicit,
        RAILWAY_GIT_COMMIT_SHA: railway,
      })
    ).toBe(explicit)
  })

  it("uses Railway's immutable source SHA without a duplicate variable", () => {
    const railway = "C".repeat(40)

    expect(
      getBackendRuntimeIdentity({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "staging",
        RAILWAY_GIT_COMMIT_SHA: railway,
      })
    ).toEqual({
      commit_sha: railway.toLowerCase(),
      environment: "staging",
      service: "backend",
    })
  })

  it("rejects malformed deployment metadata", () => {
    expect(
      getBackendRuntimeIdentity({
        COMMIT_SHA: "not-a-sha",
        RAILWAY_ENVIRONMENT_NAME: "private value with spaces",
      })
    ).toEqual({
      commit_sha: "unknown",
      environment: "unknown",
      service: "backend",
    })
  })
})
