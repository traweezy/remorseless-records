import { connection, NextResponse } from "next/server"

import { resolveStorefrontCommitSha } from "@/lib/observability/runtime-identity"

export const GET = async (): Promise<NextResponse> => {
  await connection()
  const payload: {
    status: "ok"
    uptime_seconds: number
    version?: string
  } = {
    status: "ok",
    uptime_seconds: Math.round(process.uptime()),
  }
  const commitSha = resolveStorefrontCommitSha()
  if (commitSha !== "unknown") {
    payload.version = commitSha
  }
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  })
}
