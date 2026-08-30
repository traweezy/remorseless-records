import { createClient } from "redis"

import { observeOperation } from "./observability/operation-telemetry"
import { buildBackendRuntimeEvent } from "./observability/runtime-event"

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

const writeRedisEvent = (
  level: "error" | "info" | "warn",
  event: string,
  message: string
): void => {
  const payload = JSON.stringify(buildBackendRuntimeEvent(event, message))
  console[level](payload)
}

const registerRedisEventLogging = (client: SharedRedisClient): void => {
  if (client.listenerCount("connect") === 0) {
    client.on("connect", () => {
      writeRedisEvent(
        "info",
        "redis.connection.connecting",
        "Shared Redis connection opened"
      )
    })
  }
  if (client.listenerCount("ready") === 0) {
    client.on("ready", () => {
      writeRedisEvent(
        "info",
        "redis.connection.ready",
        "Shared Redis connection is ready"
      )
    })
  }
  if (client.listenerCount("reconnecting") === 0) {
    client.on("reconnecting", () => {
      writeRedisEvent(
        "warn",
        "redis.connection.reconnecting",
        "Shared Redis connection is reconnecting"
      )
    })
  }
  if (client.listenerCount("end") === 0) {
    client.on("end", () => {
      writeRedisEvent(
        "warn",
        "redis.connection.closed",
        "Shared Redis connection closed"
      )
    })
  }
  if (client.listenerCount("error") === 0) {
    client.on("error", () => {
      writeRedisEvent(
        "error",
        "redis.connection.error",
        "Shared Redis connection error"
      )
    })
  }
}

export const withRedisTimeout = async <T>(operation: Promise<T>): Promise<T> =>
  observeOperation(
    { domain: "redis", operation: "command" },
    () =>
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
  )

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
    registerRedisEventLogging(redisClient)

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
