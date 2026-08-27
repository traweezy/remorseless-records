"use client"

import { memo } from "react"

import ErrorRecovery from "@/components/error-recovery"

type GlobalErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

const GlobalErrorComponent = ({ error, reset }: GlobalErrorProps) => (
  <html lang="en">
    <body className="min-h-screen bg-background text-foreground antialiased">
      <ErrorRecovery
        onRetry={reset}
        scope="application"
        {...(error.digest ? { digest: error.digest } : {})}
      />
    </body>
  </html>
)

const GlobalError = memo<GlobalErrorProps>(GlobalErrorComponent)
GlobalError.displayName = "GlobalError"

export default GlobalError
