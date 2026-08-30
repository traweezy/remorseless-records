import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveBackendCommitSha } from "../../lib/observability/runtime-identity"

type LivenessPayload = {
  status: "ok"
  uptime_seconds: number
  version?: string
}

export const GET = async (
  _req: MedusaRequest,
  res: MedusaResponse<LivenessPayload>
): Promise<void> => {
  res.setHeader("Cache-Control", "no-store")
  const payload: LivenessPayload = {
    status: "ok",
    uptime_seconds: Math.round(process.uptime()),
  }
  const commitSha = resolveBackendCommitSha()
  if (commitSha !== "unknown") {
    payload.version = commitSha
  }
  res.status(200).json(payload)
}
