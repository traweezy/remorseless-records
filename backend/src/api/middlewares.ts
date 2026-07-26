import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http";

import { STORE_CORS } from "../lib/constants";

type RateLimitRule = {
  key: string;
  max: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

const allowedStoreOriginHosts = new Set(
  STORE_CORS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).host.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

const extractIp = (req: MedusaRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim().length) {
    return realIp.trim();
  }

  if (typeof req.ip === "string" && req.ip.trim().length) {
    return req.ip.trim();
  }

  return "unknown";
};

const createRateLimitMiddleware =
  (rule: RateLimitRule) =>
  (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    const now = Date.now();
    const ip = extractIp(req);
    const key = `${rule.key}:${ip}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) {
            buckets.delete(bucketKey);
          }
        }
        if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
          const oldestKey = buckets.keys().next().value;
          if (typeof oldestKey === "string") {
            buckets.delete(oldestKey);
          }
        }
      }
      buckets.set(key, {
        count: 1,
        resetAt: now + rule.windowMs,
      });
      next();
      return;
    }

    if (current.count >= rule.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        type: "rate_limit_exceeded",
        message: "Too many requests. Please try again shortly.",
      });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
    next();
  };

const enforceStoreOrigin = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void => {
  const origin = req.headers.origin;

  if (!origin || typeof origin !== "string") {
    next();
    return;
  }

  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    res.status(403).json({
      type: "invalid_origin",
      message: "Origin is not allowed.",
    });
    return;
  }

  if (!allowedStoreOriginHosts.has(originHost)) {
    res.status(403).json({
      type: "invalid_origin",
      message: "Origin is not allowed.",
    });
    return;
  }

  next();
};

const strictStoreMutationRateLimit = createRateLimitMiddleware({
  key: "store:mutation",
  max: 120,
  windowMs: 60_000,
});

const catalogReadRateLimit = createRateLimitMiddleware({
  key: "store:catalog-read",
  max: 240,
  windowMs: 60_000,
});

const checkoutStatusRateLimit = createRateLimitMiddleware({
  key: "store:checkout-status",
  max: 600,
  windowMs: 60_000,
});

const contactRateLimit = createRateLimitMiddleware({
  key: "store:contact",
  max: 15,
  windowMs: 60_000,
});

const adminTaxControlRateLimit = createRateLimitMiddleware({
  key: "admin:tax-control",
  max: 30,
  windowMs: 60_000,
});

const adminTaxRecordsRateLimit = createRateLimitMiddleware({
  key: "admin:tax-records",
  max: 60,
  windowMs: 60_000,
});

export default defineMiddlewares({
  routes: [
    {
      matcher: /^\/store\/(carts|checkout)(\/.*)?$/,
      methods: ["POST", "PUT", "PATCH", "DELETE"],
      middlewares: [strictStoreMutationRateLimit, enforceStoreOrigin],
    },
    {
      matcher: /^\/store\/catalog\/products\/[^/]+\/bundle$/,
      methods: ["GET"],
      middlewares: [catalogReadRateLimit],
    },
    {
      matcher: /^\/store\/checkout\/(status|tax-link)$/,
      methods: ["POST"],
      middlewares: [checkoutStatusRateLimit],
      bodyParser: {
        sizeLimit: "2kb",
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
      matcher: /^\/admin\/tax-control(\/.*)?$/,
      methods: ["POST"],
      middlewares: [adminTaxControlRateLimit],
      bodyParser: {
        sizeLimit: "8kb",
      },
    },
    {
      matcher: /^\/admin\/tax-records(\/.*)?$/,
      methods: ["GET"],
      middlewares: [adminTaxRecordsRateLimit],
    },
  ],
});
