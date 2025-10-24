import { clientEnv } from "./env.client"
import { serverEnv } from "./env.server"

export { clientEnv, serverEnv }

export const runtimeEnv = {
  ...clientEnv,
  ...serverEnv,
  medusaBackendUrl: serverEnv.medusaBackendUrl ?? clientEnv.medusaUrl,
}
