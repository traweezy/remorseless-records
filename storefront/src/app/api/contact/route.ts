import { runtimeEnv } from "@/config/env"
import { publicFormServerEnv } from "@/config/env.public-forms.server"
import { createContactPost } from "@/features/public-forms/server/contact-handler"

export const POST = createContactPost({
  backendBase: runtimeEnv.medusaBackendUrl ?? runtimeEnv.medusaUrl,
  fetchImpl: fetch,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  publishableKey: runtimeEnv.medusaPublishableKey,
  secret: publicFormServerEnv.publicFormBffSecret,
})
