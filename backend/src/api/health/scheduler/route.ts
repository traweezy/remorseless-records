import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  readCheckoutSchedulerHealth,
  type CheckoutSchedulerHealthPayload,
} from "../../../lib/health/scheduler"

export const GET = async (
  _req: MedusaRequest,
  res: MedusaResponse<CheckoutSchedulerHealthPayload>
): Promise<void> => {
  res.setHeader("Cache-Control", "no-store")
  const health = await readCheckoutSchedulerHealth()
  res.status(health.status === "healthy" ? 200 : 503).json(health)
}
