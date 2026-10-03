import { EventEmitter } from "node:events"
import { trace } from "@opentelemetry/api"
import type { Knex } from "@mikro-orm/knex"
import {
  ensureDatabaseDiagnostics,
  observeDatabaseDiagnostics,
  withSearchDatabaseWorkload,
} from "./database-diagnostics"

const fixture = () => {
  const pool = Object.assign(new EventEmitter(), {
    numUsed: jest.fn(() => 2),
    numPendingAcquires: jest.fn(() => 3),
  })
  const client = Object.assign(new EventEmitter(), { pool })
  const database = { client } as unknown as Knex
  const emit = jest.fn()
  return { pool, client, database, emit }
}

describe("continuous database diagnostics", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("separates acquisition and SQL duration, attributes queued work, and never emits private values", () => {
    const { pool, client, database, emit } = fixture()
    jest.spyOn(trace, "getActiveSpan").mockReturnValue({
      spanContext: () => ({
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
      }),
    } as ReturnType<typeof trace.getActiveSpan>)
    const observer = observeDatabaseDiagnostics(database, emit)
    withSearchDatabaseWorkload(() => pool.emit("acquireRequest", 1))
    jest.advanceTimersByTime(1_200)
    pool.emit("acquireSuccess", 1, { password: "private-resource" })
    const query = {
      __knexQueryUid: "private-id",
      sql: "SELECT private",
      bindings: ["private-email"],
    }
    withSearchDatabaseWorkload(() => client.emit("query", query))
    jest.advanceTimersByTime(1_300)
    client.emit("query-response", [{ private: "private-row" }], query)
    pool.emit("acquireRequest", 2)
    pool.emit("acquireFail", 2, new Error("private-password"))
    client.emit("query", query)
    client.emit("query-error", new Error("private-sql-error"), query)
    jest.advanceTimersByTime(57_500)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toMatchObject({
      event: "database.diagnostics.window",
      span_id: "unknown",
      trace_id: "unknown",
      window_ms: 60_000,
      used_peak: 2,
      pending_acquires_peak: 3,
      unobserved: 0,
      in_flight_acquires: 0,
      in_flight_queries: 0,
      workloads: {
        search_index: {
          acquire: { completed: 1, slow: 1, failed: 0, max_ms: 1_200 },
          query: { completed: 1, slow: 1, failed: 0, max_ms: 1_300 },
        },
        application: {
          acquire: { completed: 1, failed: 1, slow: 0, max_ms: 0 },
          query: { completed: 1, failed: 1, slow: 0, max_ms: 0 },
        },
      },
    })
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(
      /private|SELECT|bindings|password/
    )
    jest.advanceTimersByTime(60_000)
    expect(emit.mock.calls[1][0].workloads.search_index.query.completed).toBe(0)
    observer.close()
  })

  it("shares listeners, keeps existing listeners, and shuts down timers on pool destruction", () => {
    const { pool, client, database, emit } = fixture()
    const external = jest.fn()
    client.on("query", external)
    const first = observeDatabaseDiagnostics(database, emit)
    expect(observeDatabaseDiagnostics(database, emit)).toBe(first)
    expect(pool.listenerCount("acquireRequest")).toBe(1)
    expect(client.listenerCount("query")).toBe(2)
    pool.emit("poolDestroyRequest", 1)
    first.close()
    expect(pool.eventNames()).toEqual([])
    expect(client.listeners("query")).toEqual([external])
    expect(jest.getTimerCount()).toBe(0)
    const again = observeDatabaseDiagnostics(database, emit)
    expect(again).not.toBe(first)
    again.close()
  })

  it("caps pending entries, expires missing ends, and distinguishes missing data from zero", () => {
    const { pool, client, database, emit } = fixture()
    const observer = observeDatabaseDiagnostics(database, emit)
    for (let id = 0; id < 2_049; id++) {
      pool.emit("acquireRequest", id)
      client.emit("query", { __knexQueryUid: String(id) })
    }
    client.emit("query", { __knexQueryUid: "x".repeat(129) })
    client.emit("query-response", null, null)
    pool.emit("acquireSuccess", 9_999)
    jest.advanceTimersByTime(60_000)
    expect(emit.mock.calls[0][0]).toMatchObject({
      in_flight_acquires: 2_048,
      in_flight_queries: 2_048,
      unobserved: 5,
    })
    jest.advanceTimersByTime(240_000)
    expect(emit.mock.calls[4][0]).toMatchObject({
      in_flight_acquires: 0,
      in_flight_queries: 0,
      unobserved: 4_096,
    })
    observer.close()
  })

  it("retains starts across windows and does not change database work when logging fails", () => {
    const { pool, database } = fixture()
    const emit = jest.fn((_event: Record<string, unknown>) => {
      throw new Error("private-transport-error")
    })
    const observer = observeDatabaseDiagnostics(database, emit)
    jest.advanceTimersByTime(59_000)
    pool.emit("acquireRequest", 1)
    expect(() => jest.advanceTimersByTime(2_000)).not.toThrow()
    pool.emit("acquireSuccess", 1)
    observer.close()
    expect(emit.mock.calls[1]?.[0]).toMatchObject({
      workloads: { application: { acquire: { max_ms: 2_000 } } },
    })
  })

  it("attaches through the real container keys, tolerates unavailable optional diagnostics, and deduplicates requests", () => {
    const { pool, database } = fixture()
    const info = jest.fn()
    const resolve = jest.fn((key) => {
      if (key === "__pg_connection__") return database
      if (key === "logger") return { info }
      throw new Error("unregistered")
    })
    // Use the installed framework's constant rather than assuming its spelling.
    const { ContainerRegistrationKeys } = require("@medusajs/framework/utils")
    resolve.mockImplementation((key) =>
      key === ContainerRegistrationKeys.PG_CONNECTION ? database : { info }
    )
    const container = { resolve: resolve as <T>(key: string) => T }
    ensureDatabaseDiagnostics(container)
    ensureDatabaseDiagnostics(container)
    expect(pool.listenerCount("acquireRequest")).toBe(1)
    jest.advanceTimersByTime(60_000)
    expect(JSON.parse(info.mock.calls[0][0]).event).toBe(
      "database.diagnostics.window"
    )
    pool.emit("poolDestroyRequest")
    expect(() => ensureDatabaseDiagnostics()).not.toThrow()
    expect(() =>
      ensureDatabaseDiagnostics({
        resolve: () => {
          throw new Error("private")
        },
      })
    ).not.toThrow()
    expect(() =>
      ensureDatabaseDiagnostics({ resolve: <T>() => ({}) as T })
    ).not.toThrow()
  })
})
