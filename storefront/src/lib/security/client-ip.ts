import "server-only"

import { isIP } from "node:net"

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

const normalizeIp = (value: string | null | undefined): string | null => {
  const candidate = value?.trim()
  if (!candidate) {
    return null
  }

  const normalized = candidate.startsWith("::ffff:")
    ? candidate.slice("::ffff:".length)
    : candidate

  return isIP(normalized) === 0 ? null : normalized
}

export const hasRailwayProxyBoundary = (
  environment: RuntimeEnvironment = process.env
): boolean =>
  [
    environment.RAILWAY_PROJECT_ID,
    environment.RAILWAY_ENVIRONMENT_ID,
    environment.RAILWAY_SERVICE_ID,
  ].every((value) => Boolean(value?.trim()))

export const resolveClientIp = (
  request: Request,
  environment: RuntimeEnvironment = process.env
): string => {
  if (!hasRailwayProxyBoundary(environment)) {
    return "unknown"
  }

  return normalizeIp(request.headers.get("x-real-ip")) ?? "unknown"
}
