"use client"

import { memo, useCallback, useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { sendClientErrorTelemetry } from "@/lib/observability/browser-telemetry"

type ErrorRecoveryScope = "application" | "route"

type ErrorRecoveryProps = {
  digest?: string
  onRetry: () => void
  scope: ErrorRecoveryScope
}

const recoveryCopy: Record<
  ErrorRecoveryScope,
  { description: string; eyebrow: string; title: string }
> = {
  application: {
    description:
      "The storefront could not start cleanly. Try again, or return home while the issue is investigated.",
    eyebrow: "Application error",
    title: "The signal dropped",
  },
  route: {
    description:
      "This page could not finish loading. Try the request again, or return home and continue browsing.",
    eyebrow: "Page error",
    title: "A track skipped",
  },
}

export const normalizeErrorDigest = (
  digest: string | null | undefined
): string =>
  digest && /^[A-Za-z\d_-]{1,128}$/.test(digest) ? digest : "unavailable"

const ErrorRecoveryComponent = ({
  digest,
  onRetry,
  scope,
}: ErrorRecoveryProps) => {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const safeDigest = useMemo(() => normalizeErrorDigest(digest), [digest])
  const copy = recoveryCopy[scope]
  const handleRetry = useCallback(() => {
    onRetry()
  }, [onRetry])

  useEffect(() => {
    headingRef.current?.focus()
    sendClientErrorTelemetry({
      digest: safeDigest,
      kind: "client_error",
      scope,
    })
  }, [safeDigest, scope])

  return (
    <section
      aria-labelledby="error-recovery-title"
      className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 px-4 text-center"
      role="alert"
    >
      <span className="font-headline text-sm uppercase tracking-[0.5rem] text-muted-foreground">
        {copy.eyebrow}
      </span>
      <h1
        className="font-display text-5xl uppercase tracking-[0.2rem] text-accent focus:outline-none"
        id="error-recovery-title"
        ref={headingRef}
        tabIndex={-1}
      >
        {copy.title}
      </h1>
      <p className="max-w-lg text-sm leading-6 text-muted-foreground">
        {copy.description}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button type="button" onClick={handleRetry}>
          Try again
        </Button>
        <Button asChild variant="outlined">
          <a href="/">Back to safety</a>
        </Button>
      </div>
    </section>
  )
}

const ErrorRecovery = memo<ErrorRecoveryProps>(ErrorRecoveryComponent)
ErrorRecovery.displayName = "ErrorRecovery"

export default ErrorRecovery
