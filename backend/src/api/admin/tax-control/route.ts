import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { taxControlSnapshot } from "./utils"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const snapshot = await taxControlSnapshot(req.scope)
  res.setHeader("Cache-Control", "no-store")
  res.status(200).json(snapshot)
}
