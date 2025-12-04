import { runtimeEnv } from "@/config/env"

const DEFAULT_BACKEND_BASE_URL = "https://remorseless-records-admin-staging.up.railway.app"
const PUBLISHABLE_HEADER = "x-publishable-api-key" as const

const normalizeUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withProtocol).origin
  } catch {
    return null
  }
}

const resolveBackendBaseUrl = (): string => {
  const candidates = [
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.BACKEND_URL,
    process.env.RAILWAY_SERVICE_BACKEND_URL,
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
    process.env.NEXT_PUBLIC_MEDUSA_URL,
    process.env.MEDUSA_BACKEND_URL,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate)
    if (normalized) {
      return normalized
    }
  }

  return DEFAULT_BACKEND_BASE_URL
}

export const backendBaseUrl = resolveBackendBaseUrl()

export const withBackendHeaders = (headers?: HeadersInit): HeadersInit => {
  const merged = new Headers(headers)
  merged.set(PUBLISHABLE_HEADER, runtimeEnv.medusaPublishableKey)
  return merged
}
