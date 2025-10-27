import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

type HealthPayload = {
  status: "ok"
  timestamp: string
  uptime_seconds: number
  version?: string
}

export const GET = async (
  _req: MedusaRequest,
  res: MedusaResponse<HealthPayload>
): Promise<void> => {
  const payload: HealthPayload = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
  }

  if (process.env.COMMIT_SHA) {
    payload.version = process.env.COMMIT_SHA
  }

  res.status(200).json(payload)
}
