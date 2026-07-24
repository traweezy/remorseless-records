import "server-only"

import { createClient } from "redis"

export type SharedRedisClient = ReturnType<typeof createClient>

export class RedisUnavailableError extends Error {
  constructor() {
    super("Shared Redis service unavailable")
    this.name = "RedisUnavailableError"
  }
}

export const REDIS_COMMAND_TIMEOUT_MS = 2_000

const READINESS_POLL_INTERVAL_MS = 50

let redisClient: SharedRedisClient | null = null
let redisConnection: Promise<SharedRedisClient> | null = null

export const withRedisTimeout = async <T>(operation: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new RedisUnavailableError())
    }, REDIS_COMMAND_TIMEOUT_MS)

    operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      () => {
        clearTimeout(timeout)
        reject(new RedisUnavailableError())
      }
    )
  })

export const getSharedRedisClient =
  async (): Promise<SharedRedisClient | null> => {
    const url = process.env.REDIS_URL?.trim()
    if (!url) {
      if (process.env.NODE_ENV === "production") {
        throw new RedisUnavailableError()
      }
      return null
    }

    redisClient ??= createClient({
      url,
      commandsQueueMaxLength: 1_000,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
        keepAlive: true,
      },
    })
    if (redisClient.listenerCount("error") === 0) {
      redisClient.on("error", () => {
        console.error("Shared Redis connection error")
      })
    }

    if (redisClient.isReady) {
      return redisClient
    }
    if (!redisClient.isOpen) {
      redisConnection ??= withRedisTimeout(redisClient.connect())
        .then(() => redisClient as SharedRedisClient)
        .finally(() => {
          redisConnection = null
        })
      return redisConnection
    }

    const startedAt = Date.now()
    while (!redisClient.isReady) {
      if (Date.now() - startedAt >= REDIS_COMMAND_TIMEOUT_MS) {
        throw new RedisUnavailableError()
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, READINESS_POLL_INTERVAL_MS)
      })
    }
    return redisClient
  }
