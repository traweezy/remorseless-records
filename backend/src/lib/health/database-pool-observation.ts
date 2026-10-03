import type { Knex } from "@mikro-orm/knex"

type DatabasePool = NonNullable<Knex["client"]["pool"]>

export type DatabasePoolObservation = {
  connection_create_ms: number | null
  connection_source: "created" | "reused" | "unknown"
  free_before: number
  pending_acquires_before: number
  pending_creates_before: number
  used_before: number
}

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null

type Creation = {
  at: number
  duration: number | null
  startedAt: number | null
}
type SharedObservation = {
  users: number
  created: WeakMap<object, Creation>
  close: () => void
}
const observations = new WeakMap<DatabasePool, SharedObservation>()

const subscribe = (pool: DatabasePool): SharedObservation => {
  const existing = observations.get(pool)
  if (existing) {
    existing.users += 1
    return existing
  }
  const started = new Map<number, number>()
  const created = new WeakMap<object, Creation>()
  const onRequest = (eventId: number) => {
    // Limit observation memory even if an unexpected pool emits excess events.
    if (started.size < 1_000) started.set(eventId, performance.now())
  }
  const onSuccess = (eventId: number, resource: unknown) => {
    const at = started.get(eventId)
    started.delete(eventId)
    if (isObject(resource)) {
      const completed = performance.now()
      created.set(resource, {
        at: completed,
        duration: at === undefined ? null : Math.round(completed - at),
        startedAt: at ?? null,
      })
    }
  }
  const onFailure = (eventId: number) => {
    started.delete(eventId)
  }
  pool.on("createRequest", onRequest)
  pool.on("createSuccess", onSuccess)
  pool.on("createFail", onFailure)
  const state: SharedObservation = {
    created,
    users: 1,
    close() {
      pool.removeListener("createRequest", onRequest)
      pool.removeListener("createSuccess", onSuccess)
      pool.removeListener("createFail", onFailure)
      started.clear()
      observations.delete(pool)
    },
  }
  observations.set(pool, state)
  return state
}

// Share one set of listeners while probes overlap; remove only our listeners
// when the last acquisition ends. Attribute creation to the acquired object,
// never to unrelated creates happening concurrently in the shared pool.
export const observeDatabasePool = (pool: DatabasePool) => {
  const at = performance.now()
  const before = {
    free_before: pool.numFree(),
    pending_acquires_before: pool.numPendingAcquires(),
    pending_creates_before: pool.numPendingCreates(),
    used_before: pool.numUsed(),
  }
  const state = subscribe(pool)
  let closed = false
  return {
    finish(resource: unknown): DatabasePoolObservation {
      const creation = isObject(resource) ? state.created.get(resource) : null
      const during = creation && creation.at >= at
      return {
        ...before,
        // A create already underway at subscription has no known start.
        // A concurrent older observation may know a longer, pre-probe time;
        // retain only creation durations fully inside this acquisition.
        connection_create_ms:
          during && creation.startedAt !== null && creation.startedAt >= at
            ? creation.duration
            : null,
        connection_source: !isObject(resource)
          ? "unknown"
          : during
            ? "created"
            : "reused",
      }
    },
    close(): void {
      if (closed) return
      closed = true
      state.users -= 1
      if (state.users === 0) state.close()
    },
  }
}

// Allowlist the complete diagnostic group. Do not reflect arbitrary objects
// from a probe, and do not confuse unavailable creation time with zero.
export const sanitizeDatabasePoolObservation = (
  value: unknown,
  acquisitionMs: number
): DatabasePoolObservation | undefined => {
  if (!isObject(value) || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const fields = [
    "free_before",
    "pending_acquires_before",
    "pending_creates_before",
    "used_before",
  ] as const
  if (
    !fields.every(
      (field) =>
        Object.hasOwn(row, field) &&
        typeof row[field] === "number" &&
        Number.isSafeInteger(row[field]) &&
        row[field] >= 0 &&
        row[field] <= 100_000
    ) ||
    !Object.hasOwn(row, "connection_source") ||
    !Object.hasOwn(row, "connection_create_ms")
  )
    return undefined
  const source = row.connection_source
  const duration = row.connection_create_ms
  if (
    (source !== "created" && source !== "reused" && source !== "unknown") ||
    (duration !== null &&
      (source !== "created" ||
        typeof duration !== "number" ||
        !Number.isSafeInteger(duration) ||
        duration < 0 ||
        duration > acquisitionMs))
  )
    return undefined
  return {
    connection_create_ms: duration as number | null,
    connection_source: source as DatabasePoolObservation["connection_source"],
    free_before: row.free_before as number,
    pending_acquires_before: row.pending_acquires_before as number,
    pending_creates_before: row.pending_creates_before as number,
    used_before: row.used_before as number,
  }
}
