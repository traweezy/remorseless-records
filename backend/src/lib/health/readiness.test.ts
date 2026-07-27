import { runReadinessChecks, type ReadinessProbe } from "./readiness"

describe("runReadinessChecks", () => {
  it("measures healthy dependency probes", async () => {
    const probes: ReadinessProbe[] = [
      { check: async () => undefined, name: "database" },
      { check: async () => undefined, name: "redis" },
    ]

    await expect(runReadinessChecks(probes)).resolves.toEqual([
      {
        duration_ms: expect.any(Number),
        name: "database",
        status: "ok",
      },
      {
        duration_ms: expect.any(Number),
        name: "redis",
        status: "ok",
      },
    ])
  })

  it("reports failures without exposing dependency error details", async () => {
    const secret = "redis://user:super-secret@example.test"
    const checks = await runReadinessChecks([
      {
        check: async () => {
          throw new Error(secret)
        },
        name: "redis",
      },
    ])

    expect(checks).toEqual([
      {
        duration_ms: expect.any(Number),
        name: "redis",
        status: "error",
      },
    ])
    expect(JSON.stringify(checks)).not.toContain(secret)
  })
})
