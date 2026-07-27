import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
import type { Knex } from "@mikro-orm/knex"
import { createClient } from "redis"

import { resolveObjectStorageConfig } from "../storage/config"

const DEPENDENCY_TIMEOUT_MS = 2_000
const STORAGE_TIMEOUT_MS = 5_000

export type ReadinessCheck = {
  duration_ms: number
  name: string
  status: "error" | "ok"
}

export type ReadinessProbe = {
  check: () => Promise<void>
  name: string
}

type ReadinessEnvironment = NodeJS.ProcessEnv

const runProbe = async (probe: ReadinessProbe): Promise<ReadinessCheck> => {
  const startedAt = performance.now()
  try {
    await probe.check()
    return {
      duration_ms: Math.round(performance.now() - startedAt),
      name: probe.name,
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
    await database
      .raw("select 1 as ready")
      .timeout(DEPENDENCY_TIMEOUT_MS, { cancel: true })
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
  return probes
}
