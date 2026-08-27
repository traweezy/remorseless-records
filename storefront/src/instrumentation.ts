import { validateStorefrontRuntimeSecrets } from "@/config/runtime-secret-policy"

export const register = (): void => {
  validateStorefrontRuntimeSecrets({
    isProduction: process.env.NODE_ENV === "production",
  })
}
