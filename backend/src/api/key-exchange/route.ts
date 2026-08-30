import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IApiKeyModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import { sendApiProblem } from "../../lib/http/correlation"

const unavailable = (req: MedusaRequest, res: MedusaResponse): void => {
  res.setHeader("Cache-Control", "no-store")
  sendApiProblem(req, res, {
    code: "publishable_key_unavailable",
    title: "Publishable key is unavailable",
    status: 503,
    detail: "The Store API publishable key is unavailable. Try again shortly.",
    instance: req.path,
  })
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  try {
    const apiKeyModuleService = req.scope.resolve<IApiKeyModuleService>(
      Modules.API_KEY
    )
    const apiKeys = await apiKeyModuleService.listApiKeys()
    const defaultApiKey = apiKeys.find((apiKey) => apiKey.title === "Webshop")
    if (!defaultApiKey) {
      unavailable(req, res)
      return
    }

    res.setHeader("Cache-Control", "no-store")
    res.status(200).json({ publishableApiKey: defaultApiKey.token })
  } catch {
    unavailable(req, res)
  }
}
