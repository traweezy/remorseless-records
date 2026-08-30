import type { Instrumentation } from "next"

import { validateStorefrontRuntimeSecrets } from "@/config/runtime-secret-policy"

export const register = async (): Promise<void> => {
  validateStorefrontRuntimeSecrets({
    isProduction: process.env.NODE_ENV === "production",
  })

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerStorefrontObservability } =
      await import("@/lib/observability/register")
    registerStorefrontObservability()
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return
  }

  const { logStorefrontRequestError } =
    await import("@/lib/observability/request-completion")
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  logStorefrontRequestError({
    method: request.method,
    routeType: context.routeType,
    ...(digest ? { digest } : {}),
  })
}
