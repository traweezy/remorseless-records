import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  readRetentionHealth,
  type RetentionHealthPayload,
} from "../../../lib/health/retention"

export const GET = async (
  _req: MedusaRequest,
  res: MedusaResponse<RetentionHealthPayload>
): Promise<void> => {
  res.setHeader("Cache-Control", "no-store")
  const health = await readRetentionHealth()
  res.status(health.status === "healthy" ? 200 : 503).json(health)
}
