"use client"

import { memo } from "react"

import ErrorRecovery from "@/components/error-recovery"

type RouteErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

const RouteErrorComponent = ({ error, reset }: RouteErrorProps) => (
  <ErrorRecovery
    onRetry={reset}
    scope="route"
    {...(error.digest ? { digest: error.digest } : {})}
  />
)

const RouteError = memo<RouteErrorProps>(RouteErrorComponent)
RouteError.displayName = "RouteError"

export default RouteError
