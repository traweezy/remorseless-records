import { NextResponse } from "next/server"

import {
  createStorefrontReadinessProbes,
  runReadinessChecks,
} from "@/lib/health/readiness"
import { resolveStorefrontCommitSha } from "@/lib/observability/runtime-identity"

export const GET = async (): Promise<NextResponse> => {
  const checks = await runReadinessChecks(createStorefrontReadinessProbes())
  const isReady = checks.every((check) => check.status === "ok")
  const payload: {
    checks: typeof checks
    status: "degraded" | "ok"
    version?: string
  } = {
    checks,
    status: isReady ? "ok" : "degraded",
  }
  const commitSha = resolveStorefrontCommitSha()
  if (commitSha !== "unknown") {
    payload.version = commitSha
  }
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
    status: isReady ? 200 : 503,
  })
}
