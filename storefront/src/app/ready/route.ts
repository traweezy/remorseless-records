import { NextResponse } from "next/server"

import {
  createStorefrontReadinessProbes,
  runReadinessChecks,
} from "@/lib/health/readiness"

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
  if (process.env.COMMIT_SHA) {
    payload.version = process.env.COMMIT_SHA
  }
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
    status: isReady ? 200 : 503,
  })
}
