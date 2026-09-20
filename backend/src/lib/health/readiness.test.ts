import { knex, type Knex } from "@mikro-orm/knex"

import {
  createBackendReadinessProbes,
  runReadinessChecks,
  type ReadinessProbe,
} from "./readiness"

const createDatabaseFixture = () => {
  const connection = { fixture: true }
  const timeout = jest.fn<Promise<void>, [number, { cancel: boolean }]>()
  const useConnection = jest.fn().mockReturnValue({ timeout })
  const select = jest.fn().mockReturnValue({ connection: useConnection })
  const raw = jest.fn().mockReturnValue({ fixture: "select" })
  const acquireConnection = jest.fn().mockResolvedValue(connection)
  const releaseConnection = jest.fn().mockResolvedValue(undefined)
  const database = {
    client: { acquireConnection, releaseConnection },
    raw,
    select,
  } as unknown as Knex
  const probes = createBackendReadinessProbes({
    database,
    environment: { NODE_ENV: "test" },
  })
  return {
    acquireConnection,
    connection,
    probes,
    raw,
    releaseConnection,
    select,
    timeout,
    useConnection,
  }
}

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

  it("keeps unreviewed database probe fields out of public readiness", async () => {
    const checks = await runReadinessChecks([
      {
        check: async () => ({
          pool_acquire_ms: 1,
          query_ms: 2,
          secret: "private-database-canary",
        }),
        name: "database",
      },
    ])

    expect(checks).toEqual([
      {
        duration_ms: expect.any(Number),
        name: "database",
        pool_acquire_ms: 1,
        query_ms: 2,
        status: "ok",
      },
    ])
    expect(JSON.stringify(checks)).not.toContain("private-database-canary")
  })

  it("reports separate database pool and query times with the same bounded query", async () => {
    const fixture = createDatabaseFixture()
    fixture.timeout.mockResolvedValue(undefined)

    const checks = await runReadinessChecks(fixture.probes)

    expect(checks).toHaveLength(1)
    expect(checks[0]).toEqual({
      duration_ms: expect.any(Number),
      name: "database",
      pool_acquire_ms: expect.any(Number),
      query_ms: expect.any(Number),
      status: "ok",
    })
    expect(checks[0]?.pool_acquire_ms).toBeGreaterThanOrEqual(0)
    expect(checks[0]?.query_ms).toBeGreaterThanOrEqual(0)
    expect(checks[0]?.pool_acquire_ms).toBeLessThanOrEqual(
      checks[0]?.duration_ms ?? -1
    )
    expect(checks[0]?.query_ms).toBeLessThanOrEqual(
      checks[0]?.duration_ms ?? -1
    )
    expect(fixture.raw).toHaveBeenCalledWith("1 as ready")
    expect(fixture.select).toHaveBeenCalledWith(
      fixture.raw.mock.results[0]?.value
    )
    expect(fixture.useConnection).toHaveBeenCalledWith(fixture.connection)
    expect(fixture.timeout).toHaveBeenCalledWith(2_000, { cancel: true })
    expect(fixture.releaseConnection).toHaveBeenCalledTimes(1)
    expect(fixture.releaseConnection).toHaveBeenCalledWith(fixture.connection)
  })

  it("compiles the database probe as a fixed read-only statement", async () => {
    const database = knex({ client: "pg" })
    try {
      expect(database.select(database.raw("1 as ready")).toSQL().sql).toBe(
        "select 1 as ready"
      )
    } finally {
      await database.destroy()
    }
  })

  it("releases the database connection and redacts a failed query", async () => {
    const fixture = createDatabaseFixture()
    const secret = "postgresql://user:super-secret@example.test"
    fixture.timeout.mockRejectedValue(new Error(secret))

    const checks = await runReadinessChecks(fixture.probes)

    expect(checks).toEqual([
      {
        duration_ms: expect.any(Number),
        name: "database",
        status: "error",
      },
    ])
    expect(fixture.releaseConnection).toHaveBeenCalledWith(fixture.connection)
    expect(JSON.stringify(checks)).not.toContain(secret)
  })

  it("reports a failed pool acquisition without an invalid release", async () => {
    const fixture = createDatabaseFixture()
    fixture.acquireConnection.mockRejectedValue(new Error("pool unavailable"))

    await expect(runReadinessChecks(fixture.probes)).resolves.toEqual([
      {
        duration_ms: expect.any(Number),
        name: "database",
        status: "error",
      },
    ])
    expect(fixture.select).not.toHaveBeenCalled()
    expect(fixture.releaseConnection).not.toHaveBeenCalled()
  })
})
