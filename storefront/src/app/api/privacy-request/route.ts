import { runtimeEnv } from "@/config/env"
import { publicFormServerEnv } from "@/config/env.public-forms.server"
import { createPrivacyRequestPost } from "@/features/public-forms/server/privacy-request-handler"

export const POST = createPrivacyRequestPost({
  backendBase: runtimeEnv.medusaBackendUrl ?? runtimeEnv.medusaUrl,
  fetchImpl: fetch,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  publishableKey: runtimeEnv.medusaPublishableKey,
  secret: publicFormServerEnv.publicFormBffSecret,
})
