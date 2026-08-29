import Medusa from "@medusajs/js-sdk"

import { runtimeEnv } from "@/config/env"
import { createProviderSignal } from "@/lib/http/provider-boundary"

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

const sdkFetch = medusa.client.fetch.bind(medusa.client)
medusa.client.fetch = (input, init = {}) =>
  sdkFetch(input, {
    ...init,
    signal: init.signal ?? createProviderSignal(),
  })

export const storeClient = medusa.store
