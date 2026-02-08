import { loadEnv } from '@medusajs/framework/utils'

import { assertValue } from 'utils/assert-value'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const parseOrigin = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

const uniqueOrigins = (values: Array<string | null>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))))

const normalizeCorsOrigins = (
  value: string | undefined,
  fallbackOrigins: string[],
  label: string
): string => {
  const parsed = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

  const origins = parsed.length ? parsed : fallbackOrigins

  const hasWildcard = origins.some((origin) => origin.includes("*"))
  if (hasWildcard && !IS_DEV) {
    throw new Error(`${label} must not contain wildcard origins in non-development environments`)
  }

  const sanitized = origins.filter((origin) => !origin.includes("*"))
  if (!sanitized.length) {
    throw new Error(`${label} did not resolve to any valid CORS origins`)
  }

  return Array.from(new Set(sanitized)).join(",")
}

/**
 * Is development environment
 */
export const IS_DEV = process.env.NODE_ENV === 'development'

/**
 * Public URL for the backend
 */
export const BACKEND_URL = process.env.BACKEND_PUBLIC_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN_VALUE ?? 'http://localhost:9000'

/**
 * Database URL for Postgres instance used by the backend
 */
export const DATABASE_URL = assertValue(
  process.env.DATABASE_URL,
  'Environment variable for DATABASE_URL is not set',
)

/**
 * (optional) Redis URL for Redis instance used by the backend
 */
export const REDIS_URL = process.env.REDIS_URL;

/**
 * Admin CORS origins
 */
const adminCorsFallback = uniqueOrigins([
  "http://localhost:7000",
  "http://localhost:7001",
  parseOrigin(process.env.RAILWAY_SERVICE_CONSOLE_URL),
  parseOrigin(process.env.NEXT_PUBLIC_BASE_URL),
])

export const ADMIN_CORS = normalizeCorsOrigins(
  process.env.ADMIN_CORS,
  adminCorsFallback,
  "ADMIN_CORS"
)

/**
 * Auth CORS origins
 */
const authCorsFallback = uniqueOrigins([
  "http://localhost:7000",
  "http://localhost:7001",
  "http://localhost:3000",
  parseOrigin(process.env.NEXT_PUBLIC_BASE_URL),
  parseOrigin(process.env.RAILWAY_SERVICE_STOREFRONT_URL),
])

export const AUTH_CORS = normalizeCorsOrigins(
  process.env.AUTH_CORS,
  authCorsFallback,
  "AUTH_CORS"
)

/**
 * Store/frontend CORS origins
 */
const storeCorsFallback = uniqueOrigins([
  "http://localhost:3000",
  "http://localhost:8000",
  parseOrigin(process.env.NEXT_PUBLIC_BASE_URL),
  parseOrigin(process.env.RAILWAY_SERVICE_STOREFRONT_URL),
])

export const STORE_CORS = normalizeCorsOrigins(
  process.env.STORE_CORS,
  storeCorsFallback,
  "STORE_CORS"
)

/**
 * JWT Secret used for signing JWT tokens
 */
export const JWT_SECRET = assertValue(
  process.env.JWT_SECRET,
  'Environment variable for JWT_SECRET is not set',
)

/**
 * Cookie secret used for signing cookies
 */
export const COOKIE_SECRET = assertValue(
  process.env.COOKIE_SECRET,
  'Environment variable for COOKIE_SECRET is not set',
)

/**
 * (optional) Minio configuration for file storage
 */
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
export const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
export const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const MINIO_BUCKET = process.env.MINIO_BUCKET; // Optional, if not set bucket will be called: medusa-media

/**
 * (optional) Resend API Key and from Email - do not set if using SendGrid
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;

/**
 * (optionl) SendGrid API Key and from Email - do not set if using Resend
 */
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
export const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM;

/**
 * (optional) Stripe API key and webhook secret
 */
export const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * (required at runtime) Tax rate lookup configuration
 * Keep optional here so builds that don't need runtime tax calls can succeed.
 */
export const TAX_RATE_LOOKUP_PROVIDER = process.env.TAX_RATE_LOOKUP_PROVIDER ?? 'taxrate_io'
export const TAX_RATE_LOOKUP_API_KEY = process.env.TAX_RATE_LOOKUP_API_KEY ?? ''
export const TAX_RATE_LOOKUP_MODE = process.env.TAX_RATE_LOOKUP_MODE ?? 'zip'

/**
 * (optional) Meilisearch configuration
 */
export const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST;
export const MEILISEARCH_ADMIN_KEY = process.env.MEILISEARCH_ADMIN_KEY;

/**
 * Worker mode
 */
export const WORKER_MODE =
  (process.env.MEDUSA_WORKER_MODE as 'worker' | 'server' | 'shared' | undefined) ?? 'shared'

/**
 * Disable Admin (explicitly opt out only).
 */
const disableAdminEnv = process.env.MEDUSA_DISABLE_ADMIN
export const SHOULD_DISABLE_ADMIN =
  disableAdminEnv === 'true' || disableAdminEnv === '1'
