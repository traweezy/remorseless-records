import "server-only"

import { createHash, randomUUID } from "node:crypto"

import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { getSharedRedisClient, withRedisTimeout } from "@/lib/redis/client"
import { jsonApiProblem } from "@/lib/security/route-guards"

type CartIdempotencySuccess = {
  ok: true
  cart: HttpTypes.StoreCart
  replayed: boolean
}

type CartIdempotencyFailure = {
  ok: false
  response: Response
}

type CartIdempotencyResult = CartIdempotencySuccess | CartIdempotencyFailure

type RunCartMutationOptions = {
  request: NextRequest
  operation: string
  payload: unknown
  execute: () => Promise<HttpTypes.StoreCart>
  replay: (cartId: string) => Promise<HttpTypes.StoreCart>
}

type MemoryValue = {
  value: string
  expiresAt: number
}

class CartIdempotencyStoreError extends Error {
  constructor() {
    super("Cart idempotency store unavailable")
    this.name = "CartIdempotencyStoreError"
  }
}

const completedRecordSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string().length(64),
  cartId: z.string().regex(/^cart_[A-Za-z0-9]+$/),
  completedAt: z.number().int().nonnegative(),
})

const IDEMPOTENCY_KEY_SCHEMA = z.string().uuid()
const COMPLETED_TTL_MS = 10 * 60 * 1000
const LOCK_TTL_MS = 30 * 1000
const WAIT_TIMEOUT_MS = 8 * 1000
const POLL_INTERVAL_MS = 50
const MAX_MEMORY_ENTRIES = 5_000
const KEY_PREFIX = "rr:cart:idempotency:v1"

const CLAIM_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 2
end
local claimed = redis.call("SET", KEYS[2], ARGV[1], "NX", "PX", ARGV[2])
if claimed then
  return 1
end
return 0
`

const COMPLETE_SCRIPT = `
if redis.call("GET", KEYS[2]) ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
redis.call("DEL", KEYS[2])
return 1
`

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call("DEL", KEYS[1])
`

const memoryResults = new Map<string, MemoryValue>()
const memoryLocks = new Map<string, MemoryValue>()

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

const storeOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch {
    throw new CartIdempotencyStoreError()
  }
}

const pruneMemoryStore = (
  store: Map<string, MemoryValue>,
  now: number
): void => {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key)
    }
  }
  while (store.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (typeof oldestKey !== "string") {
      break
    }
    store.delete(oldestKey)
  }
}

const readMemoryValue = (
  store: Map<string, MemoryValue>,
  key: string
): string | null => {
  const entry = store.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key)
    return null
  }
  return entry.value
}

const readCompleted = async (resultKey: string): Promise<string | null> => {
  return storeOperation(async () => {
    const client = await getSharedRedisClient()
    return client
      ? withRedisTimeout(client.get(resultKey))
      : readMemoryValue(memoryResults, resultKey)
  })
}

const claim = async (
  resultKey: string,
  lockKey: string,
  owner: string
): Promise<0 | 1 | 2> => {
  return storeOperation(async () => {
    const client = await getSharedRedisClient()
    if (client) {
      const result = await withRedisTimeout(
        client.eval(CLAIM_SCRIPT, {
          keys: [resultKey, lockKey],
          arguments: [owner, String(LOCK_TTL_MS)],
        })
      )
      return result === 1 ? 1 : result === 2 ? 2 : 0
    }

    const now = Date.now()
    pruneMemoryStore(memoryResults, now)
    pruneMemoryStore(memoryLocks, now)
    if (readMemoryValue(memoryResults, resultKey)) {
      return 2
    }
    if (readMemoryValue(memoryLocks, lockKey)) {
      return 0
    }
    memoryLocks.set(lockKey, {
      value: owner,
      expiresAt: now + LOCK_TTL_MS,
    })
    return 1
  })
}

const complete = async (
  resultKey: string,
  lockKey: string,
  owner: string,
  value: string
): Promise<boolean> => {
  return storeOperation(async () => {
    const client = await getSharedRedisClient()
    if (client) {
      const result = await withRedisTimeout(
        client.eval(COMPLETE_SCRIPT, {
          keys: [resultKey, lockKey],
          arguments: [owner, value, String(COMPLETED_TTL_MS)],
        })
      )
      return result === 1
    }

    if (readMemoryValue(memoryLocks, lockKey) !== owner) {
      return false
    }
    memoryResults.set(resultKey, {
      value,
      expiresAt: Date.now() + COMPLETED_TTL_MS,
    })
    memoryLocks.delete(lockKey)
    return true
  })
}

const release = async (lockKey: string, owner: string): Promise<void> => {
  await storeOperation(async () => {
    const client = await getSharedRedisClient()
    if (client) {
      await withRedisTimeout(
        client.eval(RELEASE_SCRIPT, {
          keys: [lockKey],
          arguments: [owner],
        })
      )
      return
    }

    if (readMemoryValue(memoryLocks, lockKey) === owner) {
      memoryLocks.delete(lockKey)
    }
  })
}

const parseCompleted = (value: string | null) => {
  if (!value) {
    return null
  }
  try {
    const parsed = completedRecordSchema.safeParse(JSON.parse(value))
    if (!parsed.success) {
      throw new CartIdempotencyStoreError()
    }
    return parsed.data
  } catch {
    throw new CartIdempotencyStoreError()
  }
}

const conflictResponse = (request: NextRequest): Response =>
  jsonApiProblem({
    status: 409,
    code: "idempotency_key_reused",
    title: "Request key already used",
    detail: "Use a new request key when changing cart mutation details.",
    instance: request.nextUrl.pathname,
  })

const inProgressResponse = (request: NextRequest): Response => {
  const response = jsonApiProblem({
    status: 409,
    code: "cart_mutation_in_progress",
    title: "Cart update still processing",
    detail: "The same cart update is still processing. Please retry shortly.",
    instance: request.nextUrl.pathname,
  })
  response.headers.set("Retry-After", "1")
  return response
}

const replayCompleted = async (
  serialized: string | null,
  fingerprint: string,
  options: RunCartMutationOptions
): Promise<CartIdempotencyResult | null> => {
  const completed = parseCompleted(serialized)
  if (!completed) {
    return null
  }
  if (completed.fingerprint !== fingerprint) {
    return { ok: false, response: conflictResponse(options.request) }
  }

  return {
    ok: true,
    cart: await options.replay(completed.cartId),
    replayed: true,
  }
}

const logMutationResult = (
  options: RunCartMutationOptions,
  startedAt: number,
  replayed: boolean
): void => {
  const requestId = IDEMPOTENCY_KEY_SCHEMA.safeParse(
    options.request.headers.get("X-Request-ID")
  )
  console.info("Cart mutation processed", {
    operation: options.operation,
    replayed,
    duration_ms: Date.now() - startedAt,
    ...(requestId.success ? { request_id: requestId.data } : {}),
  })
}

export const runIdempotentCartMutation = async (
  options: RunCartMutationOptions
): Promise<CartIdempotencyResult> => {
  const startedAt = Date.now()
  const parsedKey = IDEMPOTENCY_KEY_SCHEMA.safeParse(
    options.request.headers.get("Idempotency-Key")
  )
  if (!parsedKey.success) {
    return {
      ok: false,
      response: jsonApiProblem({
        status: 400,
        code: "idempotency_key_invalid",
        title: "Request key required",
        detail: "Provide a valid Idempotency-Key header for cart updates.",
        instance: options.request.nextUrl.pathname,
      }),
    }
  }

  const fingerprint = sha256(
    JSON.stringify({
      operation: options.operation,
      payload: options.payload,
    })
  )
  const keyHash = sha256(`${options.operation}:${parsedKey.data}`)
  const resultKey = `${KEY_PREFIX}:${keyHash}`
  const lockKey = `${resultKey}:lock`
  const owner = randomUUID()

  try {
    const existing = await replayCompleted(
      await readCompleted(resultKey),
      fingerprint,
      options
    )
    if (existing) {
      if (existing.ok) {
        logMutationResult(options, startedAt, true)
      }
      return existing
    }

    const waitStartedAt = Date.now()
    while (Date.now() - waitStartedAt < WAIT_TIMEOUT_MS) {
      const claimResult = await claim(resultKey, lockKey, owner)
      if (claimResult === 1) {
        try {
          const cart = await options.execute()
          const completed = JSON.stringify({
            version: 1,
            fingerprint,
            cartId: cart.id,
            completedAt: Date.now(),
          })
          if (!(await complete(resultKey, lockKey, owner, completed))) {
            throw new CartIdempotencyStoreError()
          }
          logMutationResult(options, startedAt, false)
          return { ok: true, cart, replayed: false }
        } catch (error: unknown) {
          await release(lockKey, owner).catch(() => undefined)
          throw error
        }
      }

      const replayed = await replayCompleted(
        await readCompleted(resultKey),
        fingerprint,
        options
      )
      if (replayed) {
        if (replayed.ok) {
          logMutationResult(options, startedAt, true)
        }
        return replayed
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, POLL_INTERVAL_MS)
      })
    }

    console.warn("Cart mutation wait timed out", {
      operation: options.operation,
      duration_ms: Date.now() - startedAt,
    })
    return { ok: false, response: inProgressResponse(options.request) }
  } catch (error: unknown) {
    if (!(error instanceof CartIdempotencyStoreError)) {
      throw error
    }

    console.error("Cart idempotency unavailable")
    return {
      ok: false,
      response: jsonApiProblem({
        status: 503,
        code: "cart_idempotency_unavailable",
        title: "Cart updates temporarily unavailable",
        detail: "Please wait a moment and try your cart update again.",
        instance: options.request.nextUrl.pathname,
      }),
    }
  }
}
