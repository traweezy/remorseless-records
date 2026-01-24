import Medusa from "@medusajs/js-sdk"

import { runtimeEnv } from "@/config/env"

if (!runtimeEnv.medusaPublishableKey) {
  throw new Error(
    "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is required to initialize the Medusa SDK"
  )
}

export const medusa = new Medusa({
  baseUrl: runtimeEnv.medusaBackendUrl,
  publishableKey: runtimeEnv.medusaPublishableKey,
  debug: process.env.NODE_ENV === "development",
})

export const storeClient = medusa.store
