import type { RemotePattern } from "next/dist/shared/lib/image-config"

import { parseAllowedOrigin } from "./content-security-policy"

const DYNAMIC_REMOTE_IMAGE_ENVIRONMENT_KEYS = [
  "NEXT_PUBLIC_MEDUSA_URL",
  "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
  "MEDUSA_BACKEND_URL",
  "NEXT_PUBLIC_MEDIA_URL",
  "NEXT_PUBLIC_ASSET_HOST",
  "NEXT_PUBLIC_CDN_HOST",
  "NEXT_PUBLIC_SEARCH_ENDPOINT",
] as const

const TRUSTED_REMOTE_IMAGE_PATTERNS = [
  {
    protocol: "https",
    hostname: "images.unsplash.com",
  },
] satisfies RemotePattern[]

type RemoteImageEnvironment = Readonly<Record<string, string | undefined>>

type ResolveRemoteImagePatternsOptions = {
  environment?: RemoteImageEnvironment
  isDevelopment: boolean
}

const parseRemotePattern = (
  value: string | null | undefined,
  isDevelopment: boolean
): RemotePattern | null => {
  const origin = parseAllowedOrigin(value)
  if (!origin) {
    return null
  }

  const url = new URL(origin)
  if (!isDevelopment && url.protocol !== "https:") {
    return null
  }

  const pattern: RemotePattern = {
    protocol: url.protocol === "http:" ? "http" : "https",
    hostname: url.hostname,
  }
  if (url.port) {
    pattern.port = url.port
  }
  return pattern
}

const remotePatternKey = (pattern: RemotePattern): string =>
  [pattern.protocol, pattern.hostname, pattern.port ?? ""].join(":")

export const resolveRemoteImagePatterns = ({
  environment = process.env,
  isDevelopment,
}: ResolveRemoteImagePatternsOptions): RemotePattern[] => {
  const patterns = [
    ...TRUSTED_REMOTE_IMAGE_PATTERNS,
    ...DYNAMIC_REMOTE_IMAGE_ENVIRONMENT_KEYS.map((key) =>
      parseRemotePattern(environment[key], isDevelopment)
    ).filter((pattern): pattern is RemotePattern => Boolean(pattern)),
  ]

  return Array.from(
    new Map(
      patterns.map((pattern) => [remotePatternKey(pattern), pattern])
    ).values()
  )
}
