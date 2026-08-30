import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Knex } from "@mikro-orm/knex"

import { readOperationalIncidentHealth } from "../../../lib/health/incidents"
import {
  evaluateOperationsHealth,
  type OperationsHealthPayload,
} from "../../../lib/health/operations"
import {
  createBackendReadinessProbes,
  runReadinessChecks,
} from "../../../lib/health/readiness"
import { readRetentionHealth } from "../../../lib/health/retention"
import { readCheckoutSchedulerHealth } from "../../../lib/health/scheduler"
import { resolveBackendCommitSha } from "../../../lib/observability/runtime-identity"

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse<OperationsHealthPayload>
): Promise<void> => {
  res.setHeader("Cache-Control", "no-store")
  const database = req.scope.resolve<Knex>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  const [dependencies, incidents, retention, scheduler] = await Promise.all([
    runReadinessChecks(createBackendReadinessProbes({ database })),
    readOperationalIncidentHealth(),
    readRetentionHealth(),
    readCheckoutSchedulerHealth(),
  ])
  const payload: OperationsHealthPayload = evaluateOperationsHealth({
    dependencies,
    incidents,
    retention,
    scheduler,
  })
  const commitSha = resolveBackendCommitSha()
  if (commitSha !== "unknown") {
    payload.version = commitSha
  }
  res.status(payload.status === "healthy" ? 200 : 503).json(payload)
}
