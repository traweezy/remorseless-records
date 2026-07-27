import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

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
  if (process.env.COMMIT_SHA) {
    payload.version = process.env.COMMIT_SHA
  }
  res.status(200).json(payload)
}
