import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"

import { STORE_CORS } from "../lib/constants"

type RateLimitRule = {
  key: string
  max: number
  windowMs: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitBucket>()

const allowedStoreOriginHosts = new Set(
  STORE_CORS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).host.toLowerCase()
      } catch {
        return ""
      }
    })
    .filter(Boolean)
)

const extractIp = (req: MedusaRequest): string => {
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.trim().length) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) {
      return first
    }
  }

  const realIp = req.headers["x-real-ip"]
  if (typeof realIp === "string" && realIp.trim().length) {
    return realIp.trim()
  }

  if (typeof req.ip === "string" && req.ip.trim().length) {
    return req.ip.trim()
  }

  return "unknown"
}

const createRateLimitMiddleware =
  (rule: RateLimitRule) =>
  (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    const now = Date.now()
    const ip = extractIp(req)
    const key = `${rule.key}:${ip}`
    const current = buckets.get(key)

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + rule.windowMs,
      })
      next()
      return
    }

    if (current.count >= rule.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000)
      )
      res.setHeader("Retry-After", String(retryAfterSeconds))
      res.status(429).json({
        type: "rate_limit_exceeded",
        message: "Too many requests. Please try again shortly.",
      })
      return
    }

    current.count += 1
    buckets.set(key, current)
    next()
  }

const enforceStoreOrigin = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void => {
  const origin = req.headers.origin

  if (!origin || typeof origin !== "string") {
    next()
    return
  }

  let originHost = ""
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    res.status(403).json({
      type: "invalid_origin",
      message: "Origin is not allowed.",
    })
    return
  }

  if (!allowedStoreOriginHosts.has(originHost)) {
    res.status(403).json({
      type: "invalid_origin",
      message: "Origin is not allowed.",
    })
    return
  }

  next()
}

const strictStoreMutationRateLimit = createRateLimitMiddleware({
  key: "store:mutation",
  max: 120,
  windowMs: 60_000,
})

const checkoutRateLimit = createRateLimitMiddleware({
  key: "store:checkout",
  max: 40,
  windowMs: 60_000,
})

const contactRateLimit = createRateLimitMiddleware({
  key: "store:contact",
  max: 15,
  windowMs: 60_000,
})

const webhookRateLimit = createRateLimitMiddleware({
  key: "stripe:webhook",
  max: 120,
  windowMs: 60_000,
})

export default defineMiddlewares({
  routes: [
    {
      matcher: /^\/store\/(carts|checkout)(\/.*)?$/,
      methods: ["POST", "PUT", "PATCH", "DELETE"],
      middlewares: [strictStoreMutationRateLimit, enforceStoreOrigin],
    },
    {
      matcher: "/store/checkout/stripe-session",
      methods: ["POST"],
      middlewares: [checkoutRateLimit, enforceStoreOrigin],
      bodyParser: {
        sizeLimit: "8kb",
      },
    },
    {
      matcher: "/store/contact",
      methods: ["POST"],
      middlewares: [contactRateLimit, enforceStoreOrigin],
      bodyParser: {
        sizeLimit: "16kb",
      },
    },
    {
      matcher: "/webhooks/stripe",
      methods: ["POST"],
      middlewares: [webhookRateLimit],
      bodyParser: {
        preserveRawBody: true,
        sizeLimit: "2mb",
      },
    },
    {
      matcher: "/api/webhooks/stripe",
      methods: ["POST"],
      middlewares: [webhookRateLimit],
      bodyParser: {
        preserveRawBody: true,
        sizeLimit: "2mb",
      },
    },
  ],
})
