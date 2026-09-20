import { scheduledBullJobIdentity } from "./scheduled-job-identity"

describe("scheduled BullMQ identity observation", () => {
  it("accepts only the worker-produced lowercase digest", () => {
    const digest = "a".repeat(64)
    const observed = scheduledBullJobIdentity(digest)
    expect(observed).toEqual({
      bull_job_id_sha256: digest,
      bull_job_identity_verified: true,
    })
  })

  it("does not claim identity for missing, raw, or malformed IDs", () => {
    for (const value of [
      undefined,
      null,
      123,
      `repeat:${"a".repeat(32)}:1790000000000`,
      "private@example.com",
      "private\njob",
      "A".repeat(64),
      "x".repeat(65),
    ]) {
      const observed = scheduledBullJobIdentity(value)
      expect(observed).toEqual({
        bull_job_id_sha256: null,
        bull_job_identity_verified: false,
      })
      if (typeof value === "string") {
        expect(JSON.stringify(observed)).not.toContain(value)
      }
    }
  })
})
