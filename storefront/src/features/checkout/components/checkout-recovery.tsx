"use client"

import { LoaderCircle, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { memo, useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import SmartLink from "@/components/ui/smart-link"
import { getCheckoutStatus } from "@/features/checkout/api/checkout-api"

const RECOVERY_TIMEOUT_MS = 2 * 60_000
const RECOVERY_DELAYS_MS = [0, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000]

type RecoveryPhase = "checking" | "delayed" | "unavailable"

export const CheckoutRecovery = memo(() => {
  const router = useRouter()
  const [phase, setPhase] = useState<RecoveryPhase>("checking")
  const [attempt, setAttempt] = useState(0)
  const runIdRef = useRef(0)

  const reconcile = useCallback(async (): Promise<void> => {
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    const startedAt = Date.now()
    setPhase("checking")
    setAttempt(0)

    for (
      let index = 0;
      Date.now() - startedAt < RECOVERY_TIMEOUT_MS;
      index += 1
    ) {
      const delay =
        RECOVERY_DELAYS_MS[Math.min(index, RECOVERY_DELAYS_MS.length - 1)] ??
        10_000
      if (delay > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, delay)
        })
      }
      if (runIdRef.current !== runId) {
        return
      }

      try {
        const status = await getCheckoutStatus()
        if (runIdRef.current !== runId) {
          return
        }
        setAttempt(index + 1)

        switch (status) {
          case "order_confirmed":
            router.replace("/checkout/confirmation")
            return
          case "payment_action_required":
          case "payment_failed":
          case "cart_active":
            router.replace("/checkout")
            return
          case "cart_missing":
            router.replace("/catalog")
            return
          case "payment_processing":
          case "finalizing_order":
            if (Date.now() - startedAt > 12_000) {
              setPhase("delayed")
            }
            break
        }
      } catch {
        if (Date.now() - startedAt > 12_000) {
          setPhase("delayed")
        }
      }
    }

    if (runIdRef.current === runId) {
      setPhase("unavailable")
    }
  }, [router])

  useEffect(() => {
    void reconcile()
    return () => {
      runIdRef.current += 1
    }
  }, [reconcile])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-16 sm:px-6">
      <Card variant="panel" className="w-full">
        <CardHeader className="items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
            {phase === "unavailable" ? (
              <ShieldCheck className="h-7 w-7" aria-hidden="true" />
            ) : (
              <LoaderCircle
                className="h-7 w-7 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
          </div>
          <h1 className="font-headline text-3xl uppercase tracking-[0.18rem] text-foreground sm:text-4xl">
            {phase === "checking"
              ? "Confirming your order"
              : phase === "delayed"
                ? "Still confirming"
                : "Confirmation is taking longer"}
          </h1>
        </CardHeader>
        <CardContent className="space-y-5 text-center">
          <div aria-live="polite" aria-atomic="true">
            <p className="text-sm leading-6 text-muted-foreground">
              {phase === "checking"
                ? "Keep this page open while we verify the final result."
                : phase === "delayed"
                  ? "Your payment may still be processing. Do not submit it again."
                  : "Do not pay again. Check your email for a receipt, or retry the status check."}
            </p>
            {attempt > 1 && phase !== "unavailable" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Status check {attempt}
              </p>
            ) : null}
          </div>

          {phase === "unavailable" ? (
            <div className="flex flex-wrap justify-center gap-3">
              <Button type="button" onClick={() => void reconcile()}>
                Check again
              </Button>
              <Button asChild variant="outline">
                <SmartLink href="/contact">Contact support</SmartLink>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
})
CheckoutRecovery.displayName = "CheckoutRecovery"
