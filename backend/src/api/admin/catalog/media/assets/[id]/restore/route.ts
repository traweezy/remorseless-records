import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { runMediaLifecycleRoute } from "../../lifecycle-route"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> =>
  runMediaLifecycleRoute(req, res, "catalog.media.restore")
