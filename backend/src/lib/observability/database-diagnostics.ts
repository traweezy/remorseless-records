import { AsyncLocalStorage } from "node:async_hooks"
import { context, ROOT_CONTEXT } from "@opentelemetry/api"
import type { Knex } from "@mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buildBackendRuntimeEvent } from "./runtime-event"

type Workload = "application" | "search_index"
const workload = new AsyncLocalStorage<Workload>()
export const withSearchDatabaseWorkload = <T>(task: () => T): T =>
  workload.run("search_index", task)

type Pool = NonNullable<Knex["client"]["pool"]>
type Start = { at: number; workload: Workload }
const MAX_PENDING = 2_048
const MAX_AGE_MS = 300_000
const SLOW_MS = 1_000
const MAX_COUNT = 1_000_000_000
const increment = (n: number) => Math.min(n + 1, MAX_COUNT)
const emptyTiming = () => ({ completed: 0, failed: 0, slow: 0, max_ms: 0 })
const emptyWorkload = () => ({ acquire: emptyTiming(), query: emptyTiming() })
const observed = new WeakMap<Pool, { close: () => void }>()

// Instrument the registered Knex client once, independently of readiness
// requests. Retain only opaque event IDs, monotonic times and two fixed labels;
// never retain query objects, SQL, bindings, resources or exception details.
export const observeDatabaseDiagnostics = (
  database: Knex,
  emit: (event: Record<string, unknown>) => void
): { close: () => void } => {
  const pool = database.client.pool
  if (!pool) throw new Error("Database diagnostic pool unavailable")
  const existing = observed.get(pool)
  if (existing) return existing
  const client = database.client
  const acquires = new Map<number, Start>()
  const queries = new Map<string, Start>()
  let groups = { application: emptyWorkload(), search_index: emptyWorkload() }
  let dropped = 0
  let usedPeak = 0
  let waitingPeak = 0
  let started = performance.now()
  let closed = false
  let sampleScheduled = false
  const sample = () => {
    usedPeak = Math.max(usedPeak, pool.numUsed())
    waitingPeak = Math.max(waitingPeak, pool.numPendingAcquires())
  }
  const begin = <K>(map: Map<K, Start>, key: K) => {
    sample()
    if (map.size >= MAX_PENDING || map.has(key)) {
      dropped = increment(dropped)
      return
    }
    map.set(key, {
      at: performance.now(),
      workload: workload.getStore() ?? "application",
    })
  }
  const finish = <K>(
    map: Map<K, Start>,
    key: K,
    kind: "query" | "acquire",
    failed: boolean
  ) => {
    sample()
    const entry = map.get(key)
    map.delete(key)
    if (!entry) {
      dropped = increment(dropped)
      return
    }
    const duration = Math.max(0, performance.now() - entry.at)
    const target = groups[entry.workload][kind]
    target.completed = increment(target.completed)
    if (failed) target.failed = increment(target.failed)
    if (duration >= SLOW_MS) target.slow = increment(target.slow)
    target.max_ms = Math.max(
      target.max_ms,
      Math.min(MAX_COUNT, Math.round(duration))
    )
  }
  const queryKey = (query: unknown): string | undefined => {
    if (!query || typeof query !== "object") return undefined
    const key = (query as { __knexQueryUid?: unknown }).__knexQueryUid
    return typeof key === "string" && key.length > 0 && key.length <= 128
      ? key
      : undefined
  }
  const onAcquire = (id: number) => {
    if (Number.isSafeInteger(id)) begin(acquires, id)
    // Tarn emits acquireRequest before adding the pending request. Observe once
    // after that synchronous turn so short queue bursts survive the 5s sampler.
    if (!sampleScheduled) {
      sampleScheduled = true
      queueMicrotask(() => {
        sampleScheduled = false
        if (!closed) sample()
      })
    }
  }
  const onAcquireSuccess = (id: number) =>
    finish(acquires, id, "acquire", false)
  const onAcquireFail = (id: number) => finish(acquires, id, "acquire", true)
  const onQuery = (query: unknown) => {
    const key = queryKey(query)
    if (key) begin(queries, key)
    else dropped = increment(dropped)
  }
  const endQuery = (query: unknown, failed: boolean) => {
    const key = queryKey(query)
    if (key) finish(queries, key, "query", failed)
    else dropped = increment(dropped)
  }
  const onResponse = (_response: unknown, query: unknown) =>
    endQuery(query, false)
  const onError = (_error: unknown, query: unknown) => endQuery(query, true)
  const flush = () => {
    sample()
    const now = performance.now()
    for (const map of [acquires, queries]) {
      for (const [key, value] of map) {
        if (now - value.at >= MAX_AGE_MS) {
          // The map union is read safely above; delete accepts either ID kind.
          ;(map as Map<string | number, Start>).delete(key)
          dropped = increment(dropped)
        }
      }
    }
    try {
      emit({
        ...buildBackendRuntimeEvent(
          "database.diagnostics.window",
          "Database timing and pool window"
        ),
        // A process-wide window does not belong to the request that attached it.
        span_id: "unknown",
        trace_id: "unknown",
        scope: "registered_application_pool",
        window_ms: Math.round(now - started),
        slow_threshold_ms: SLOW_MS,
        used_peak: usedPeak,
        pending_acquires_peak: waitingPeak,
        in_flight_acquires: acquires.size,
        in_flight_queries: queries.size,
        unobserved: dropped,
        workloads: groups,
      })
    } catch {
      /* A log transport failure must not affect database work. */
    }
    groups = { application: emptyWorkload(), search_index: emptyWorkload() }
    dropped = 0
    usedPeak = 0
    waitingPeak = 0
    started = now
  }
  pool.on("acquireRequest", onAcquire)
  pool.on("acquireSuccess", onAcquireSuccess)
  pool.on("acquireFail", onAcquireFail)
  client.on("query", onQuery)
  client.on("query-response", onResponse)
  client.on("query-error", onError)
  const [sampler, reporter] = context.with(ROOT_CONTEXT, () =>
    workload.exit(
      () => [setInterval(sample, 5_000), setInterval(flush, 60_000)] as const
    )
  )
  sampler.unref()
  reporter.unref()
  const result = {
    close() {
      if (closed) return
      closed = true
      clearInterval(sampler)
      clearInterval(reporter)
      flush()
      pool.removeListener("acquireRequest", onAcquire)
      pool.removeListener("acquireSuccess", onAcquireSuccess)
      pool.removeListener("acquireFail", onAcquireFail)
      pool.removeListener("poolDestroyRequest", result.close)
      client.removeListener("query", onQuery)
      client.removeListener("query-response", onResponse)
      client.removeListener("query-error", onError)
      acquires.clear()
      queries.clear()
      observed.delete(pool)
    },
  }
  pool.on("poolDestroyRequest", result.close)
  observed.set(pool, result)
  return result
}

type Container = { resolve: <T = unknown>(key: string) => T }
export const ensureDatabaseDiagnostics = (container?: Container): void => {
  if (!container) return
  try {
    const database = container.resolve<Knex>(
      ContainerRegistrationKeys.PG_CONNECTION
    )
    if (!database?.client?.pool) return
    if (observed.has(database.client.pool)) return
    const logger = container.resolve<{ info: (message: string) => void }>(
      ContainerRegistrationKeys.LOGGER
    )
    observeDatabaseDiagnostics(database, (event) =>
      logger.info(JSON.stringify(event))
    )
  } catch {
    /* Optional diagnostics cannot block application startup or requests. */
  }
}
