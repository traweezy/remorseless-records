import { verifyFailedCreationRepairTarget } from "./failed-creation-repair-target"

const sha = "a".repeat(40)
const environment = {
  RAILWAY_PROJECT_ID: "1f39263a-25e4-4d69-abc2-f0287b331d1e",
  RAILWAY_ENVIRONMENT_ID: "799a2f98-f819-495d-b8b6-12e71af86568",
  RAILWAY_SERVICE_ID: "99d4fd5e-955b-416a-9078-0266bcf949d2",
  RAILWAY_GIT_COMMIT_SHA: sha,
}

describe("pure failed-creation staging target guard", () => {
  it("admits only the exact deployed staging Backend identity", () => {
    expect(() =>
      verifyFailedCreationRepairTarget(environment, sha)
    ).not.toThrow()
  })
  it.each(Object.keys(environment))("rejects missing or changed %s", (key) => {
    for (const value of [undefined, "changed"])
      expect(() =>
        verifyFailedCreationRepairTarget({ ...environment, [key]: value }, sha)
      ).toThrow("exact deployed staging")
  })
  it.each(["", "a".repeat(39), "a".repeat(41), "A".repeat(40), "unknown"])(
    "rejects malformed or fallback SHA %s",
    (requested) => {
      expect(() =>
        verifyFailedCreationRepairTarget(
          { ...environment, RAILWAY_GIT_COMMIT_SHA: requested },
          requested
        )
      ).toThrow("exact deployed staging")
    }
  )
})
