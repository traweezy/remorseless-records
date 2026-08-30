import "server-only"

import { getSharedRedisClient, withRedisTimeout } from "@/lib/redis/client"

const BACKEND_TIMEOUT_MS = 3_000

export type ReadinessCheck = {
  duration_ms: number
  name: string
  status: "error" | "ok"
}

export type ReadinessProbe = {
  check: () => Promise<void>
  name: string
}

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

const backendProbe = (backendUrl: string | undefined): ReadinessProbe => ({
  name: "backend",
  check: async () => {
    if (!backendUrl) {
      throw new Error("Backend URL is not configured.")
    }
    const response = await fetch(new URL("/ready", backendUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error("Backend is not ready.")
    }
  },
})

const redisProbe = (): ReadinessProbe => ({
  name: "redis",
  check: async () => {
    const client = await getSharedRedisClient()
    if (!client) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Redis is not configured.")
      }
      return
    }
    await withRedisTimeout(client.ping())
  },
})

export const createStorefrontReadinessProbes = (
  environment: NodeJS.ProcessEnv = process.env
): ReadinessProbe[] => {
  const backendUrl = environment.MEDUSA_BACKEND_URL?.trim()

  return [
    backendProbe(
      backendUrl?.length
        ? backendUrl
        : environment.NEXT_PUBLIC_MEDUSA_URL?.trim()
    ),
    redisProbe(),
  ]
}
