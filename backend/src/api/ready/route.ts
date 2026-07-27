import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Knex } from "@mikro-orm/knex"

import {
  createBackendReadinessProbes,
  runReadinessChecks,
  type ReadinessCheck,
} from "../../lib/health/readiness"

type ReadinessPayload = {
  checks: ReadinessCheck[]
  status: "degraded" | "ok"
  version?: string
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse<ReadinessPayload>
): Promise<void> => {
  res.setHeader("Cache-Control", "no-store")
  const database = req.scope.resolve<Knex>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  const checks = await runReadinessChecks(
    createBackendReadinessProbes({ database })
  )
  const isReady = checks.every((check) => check.status === "ok")
  const payload: ReadinessPayload = {
    checks,
    status: isReady ? "ok" : "degraded",
  }
  if (process.env.COMMIT_SHA) {
    payload.version = process.env.COMMIT_SHA
  }
  res.status(isReady ? 200 : 503).json(payload)
}
