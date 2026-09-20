import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
import type { Knex } from "@mikro-orm/knex"
import { createClient } from "redis"

import { resolveObjectStorageConfig } from "../storage/config"
import {
  observeOperation,
  type ObservedOperation,
} from "../observability/operation-telemetry"
import { resolveOperationalCapabilities } from "./capabilities"

const DEPENDENCY_TIMEOUT_MS = 2_000
// Cold pool creation can exceed 2s; do not let a health probe queue for Knex's 60s default.
const DATABASE_ACQUIRE_TIMEOUT_MS = 5_000
const STORAGE_TIMEOUT_MS = 5_000

export type ReadinessCheck = {
  duration_ms: number
  name: string
  pool_acquire_ms?: number
  query_ms?: number
  status: "error" | "ok"
}

type DatabaseProbeTimings = {
  pool_acquire_ms: number
  query_ms: number
}

export type ReadinessProbe = {
  check: () => Promise<unknown>
  name: string
}

type ReadinessEnvironment = NodeJS.ProcessEnv

type ConnectionOptionsWithPassword = { password?: unknown }
type DatabaseConnection = {
  config?: ConnectionOptionsWithPassword & {
    authentication?: { options?: ConnectionOptionsWithPassword }
  }
}

const hidePassword = (
  options: ConnectionOptionsWithPassword | undefined
): void => {
  if (options?.password) {
    Object.defineProperty(options, "password", {
      enumerable: false,
      value: options.password,
    })
  }
}

const hideDatabaseConnectionPasswords = (connection: unknown): void => {
  if (typeof connection !== "object" || connection === null) {
    return
  }
  const config = (connection as DatabaseConnection).config
  hidePassword(config)
  hidePassword(config?.authentication?.options)
}

const isDatabaseProbeTimings = (
  value: unknown
): value is DatabaseProbeTimings => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pool_acquire_ms" in value) ||
    !("query_ms" in value)
  ) {
    return false
  }
  const poolAcquireMs = value.pool_acquire_ms
  const queryMs = value.query_ms
  return (
    typeof poolAcquireMs === "number" &&
    Number.isSafeInteger(poolAcquireMs) &&
    poolAcquireMs >= 0 &&
    typeof queryMs === "number" &&
    Number.isSafeInteger(queryMs) &&
    queryMs >= 0
  )
}

const observationForProbe = (name: string): ObservedOperation | null => {
  switch (name) {
    case "database":
      return { domain: "database", operation: "health_check" }
    case "redis":
      return { domain: "redis", operation: "health_check" }
    case "search":
      return { domain: "search", operation: "health_check" }
    case "object_storage":
      return { domain: "storage", operation: "health_check" }
    default:
      return null
  }
}

const runProbe = async (probe: ReadinessProbe): Promise<ReadinessCheck> => {
  const startedAt = performance.now()
  try {
    const observation = observationForProbe(probe.name)
    const timings = observation
      ? await observeOperation(observation, probe.check)
      : await probe.check()
    return {
      duration_ms: Math.round(performance.now() - startedAt),
      name: probe.name,
      ...(probe.name === "database" && isDatabaseProbeTimings(timings)
        ? {
            pool_acquire_ms: timings.pool_acquire_ms,
            query_ms: timings.query_ms,
          }
        : {}),
      status: "ok",
    }
  } catch {
    return {
      duration_ms: Math.round(performance.now() - startedAt),
      name: probe.name,
      status: "error",
    }
  }
}

export const runReadinessChecks = async (
  probes: ReadinessProbe[]
): Promise<ReadinessCheck[]> => Promise.all(probes.map(runProbe))

const databaseProbe = (database: Knex): ReadinessProbe => ({
  name: "database",
  check: async () => {
    const pool = database.client.pool
    if (!pool) {
      throw new Error("Database pool is unavailable.")
    }
    const acquisitionStartedAt = performance.now()
    // Tarn abort removes this probe from the shared queue without changing
    // application-wide pool deadlines. Knex does not expose a per-call limit.
    const pending = pool.acquire()
    const acquireTimer = setTimeout(
      () => pending.abort(),
      DATABASE_ACQUIRE_TIMEOUT_MS
    )
    let connection: unknown
    try {
      connection = await pending.promise
    } finally {
      clearTimeout(acquireTimer)
    }
    const poolAcquireMs = Math.round(performance.now() - acquisitionStartedAt)
    try {
      // Direct pool acquisition skips Knex's credential masking. Preserve it
      // before passing the connection to the query builder or instrumentation.
      hideDatabaseConnectionPasswords(connection)
      const queryStartedAt = performance.now()
      await database
        .select(database.raw("1 as ready"))
        .connection(connection)
        .timeout(DEPENDENCY_TIMEOUT_MS, { cancel: true })
      return {
        pool_acquire_ms: poolAcquireMs,
        query_ms: Math.round(performance.now() - queryStartedAt),
      }
    } finally {
      await database.client.releaseConnection(connection)
    }
  },
})

const redisProbe = (url: string): ReadinessProbe => ({
  name: "redis",
  check: async () => {
    const client = createClient({
      disableOfflineQueue: true,
      socket: {
        connectTimeout: DEPENDENCY_TIMEOUT_MS,
        reconnectStrategy: false,
      },
      url,
    })
    client.on("error", () => undefined)
    try {
      await client.connect()
      await client.ping()
    } finally {
      client.destroy()
    }
  },
})

const meilisearchProbe = (host: string): ReadinessProbe => ({
  name: "search",
  check: async () => {
    const response = await fetch(new URL("/health", host), {
      cache: "no-store",
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error("Search service is unavailable.")
    }
  },
})

const storageProbe = (
  config: NonNullable<ReturnType<typeof resolveObjectStorageConfig>>
): ReadinessProbe => ({
  name: "object_storage",
  check: async () => {
    const client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region,
    })
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
        abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      })
    } finally {
      client.destroy()
    }
  },
})

const capabilityProbes = (
  environment: ReadinessEnvironment
): ReadinessProbe[] =>
  resolveOperationalCapabilities(environment).map((capability) => ({
    name: `capability_${capability.name}`,
    check: async () => {
      if (!capability.ready) {
        throw new Error("Operational capability is not ready.")
      }
    },
  }))

export const createBackendReadinessProbes = ({
  database,
  environment = process.env,
}: {
  database: Knex
  environment?: ReadinessEnvironment
}): ReadinessProbe[] => {
  const probes = [databaseProbe(database)]
  const redisUrl = environment.REDIS_URL?.trim()
  if (redisUrl) {
    probes.push(redisProbe(redisUrl))
  }

  const searchHost = environment.MEILISEARCH_HOST?.trim()
  if (searchHost) {
    probes.push(meilisearchProbe(searchHost))
  }

  const storageConfig = resolveObjectStorageConfig({
    environment,
    required: false,
  })
  if (storageConfig) {
    probes.push(storageProbe(storageConfig))
  }
  if (environment.NODE_ENV === "production") {
    probes.push(...capabilityProbes(environment))
  }
  return probes
}
