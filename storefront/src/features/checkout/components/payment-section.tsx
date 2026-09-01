"use client"

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js/pure"
import type {
  Appearance,
  Stripe,
  StripeElementsOptions,
  StripePaymentElementOptions,
  StripePaymentElementChangeEvent,
} from "@stripe/stripe-js"
import { Lock } from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { clientEnv } from "@/config/env.client"
import type {
  CheckoutCompletion,
  CheckoutApiError,
} from "@/features/checkout/api/checkout-api"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import { CheckoutDisclosure } from "@/features/checkout/components/checkout-disclosure"
import {
  safeStripeErrorMessage,
  stripeResultNeedsReconciliation,
} from "@/features/checkout/lib/checkout-copy"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"
import { formatAmount } from "@/lib/money"

let stripePromise: PromiseLike<Stripe | null> | null = null

const getStripePromise = (): PromiseLike<Stripe | null> => {
  stripePromise ??= loadStripe(clientEnv.stripePublishableKey)
  return stripePromise
}

const appearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#e53e3e",
    colorBackground: "#121212",
    colorText: "#f4f4f5",
    colorTextSecondary: "#a1a1aa",
    colorDanger: "#f87171",
    borderRadius: "14px",
    fontFamily: "Inter, system-ui, sans-serif",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": {
      border: "1px solid #3f3f46",
      boxShadow: "none",
      padding: "12px 14px",
    },
    ".Input:focus": {
      borderColor: "#e53e3e",
      boxShadow: "0 0 0 2px rgba(229, 62, 62, 0.35)",
    },
    ".Tab": {
      border: "1px solid #3f3f46",
    },
    ".Tab--selected": {
      borderColor: "#e53e3e",
      boxShadow: "0 0 0 1px #e53e3e",
    },
  },
}

type PaymentSectionProps = {
  checkout: CheckoutProjection
  isPreparing: boolean
  prepareError: Error | null
  onPrepare: (revision: string) => Promise<CheckoutProjection>
  onComplete: (revision: string) => Promise<CheckoutCompletion>
  onConfirmed: (orderNumber: string | null) => void
  onRecovery: () => void
}

type PaymentElementFormProps = Omit<
  PaymentSectionProps,
  "isPreparing" | "prepareError"
> & {
  isUpdating: boolean
}

const PaymentElementForm = memo<PaymentElementFormProps>(
  ({
    checkout,
    isUpdating,
    onPrepare,
    onComplete,
    onConfirmed,
    onRecovery,
  }) => {
    const stripe = useStripe()
    const elements = useElements()
    const [isReady, setIsReady] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isComplete, setIsComplete] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const disclosureId = useId()
    const submissionLockRef = useRef(false)
    const hasBeenReadyRef = useRef(false)

    const submit = useCallback(
      async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault()
        if (!stripe || !elements || isUpdating || submissionLockRef.current) {
          return
        }

        submissionLockRef.current = true
        setMessage(null)
        setIsSubmitting(true)
        let confirmationAttempted = false

        try {
          const submitted = await elements.submit()
          if (submitted.error) {
            setMessage(safeStripeErrorMessage(submitted.error))
            return
          }

          const prepared = await onPrepare(checkout.revision)
          if (
            prepared.revision !== checkout.revision ||
            prepared.payment.clientSecret !== checkout.payment.clientSecret
          ) {
            setMessage(
              "Your order total changed. Review the updated total before paying."
            )
            return
          }

          const clientSecret = prepared.payment.clientSecret
          if (!clientSecret) {
            setMessage(
              "Secure payment could not be prepared. Review the order and try again."
            )
            return
          }

          confirmationAttempted = true
          const result = await stripe.confirmPayment({
            elements,
            clientSecret,
            confirmParams: {
              return_url: `${window.location.origin}/checkout/return`,
            },
            redirect: "if_required",
          })

          if (result.error) {
            setMessage(safeStripeErrorMessage(result.error))
            if (stripeResultNeedsReconciliation(result.error)) {
              onRecovery()
            }
            return
          }

          const completed = await onComplete(prepared.revision)
          onConfirmed(completed.confirmation.orderNumber)
        } catch (error: unknown) {
          if (confirmationAttempted) {
            onRecovery()
            return
          }
          if (error && typeof error === "object" && "problem" in error) {
            const problem = (error as CheckoutApiError).problem
            if (
              [
                "completion_in_progress",
                "order_finalizing",
                "payment_processing",
                "payment_result_unknown",
                "recovery_required",
              ].includes(problem.code)
            ) {
              onRecovery()
              return
            }
            setMessage(problem.detail)
            return
          }
          setMessage(
            "Payment could not be completed. Check your connection and try again."
          )
        } finally {
          submissionLockRef.current = false
          setIsSubmitting(false)
        }
      },
      [
        checkout.payment.clientSecret,
        checkout.revision,
        elements,
        isUpdating,
        onComplete,
        onConfirmed,
        onPrepare,
        onRecovery,
        stripe,
      ]
    )

    const paymentOptions = useMemo<StripePaymentElementOptions>(() => {
      const email = checkout.cart.contact?.email
      const deliveryAddress = checkout.cart.deliveryAddress
      const name = deliveryAddress
        ? `${deliveryAddress.firstName} ${deliveryAddress.lastName}`
        : null

      return {
        layout: {
          type: "tabs",
          defaultCollapsed: false,
          radios: "auto",
          spacedAccordionItems: true,
        },
        defaultValues: {
          billingDetails: {
            ...(email ? { email } : {}),
            ...(name ? { name } : {}),
          },
        },
        wallets: {
          applePay: "auto",
          googlePay: "auto",
          link: "auto",
        },
      }
    }, [checkout.cart.contact?.email, checkout.cart.deliveryAddress])

    const handleLoaderStart = useCallback((): void => {
      if (!hasBeenReadyRef.current) {
        setIsReady(false)
      }
    }, [])

    const handleReady = useCallback((): void => {
      hasBeenReadyRef.current = true
      setIsReady(true)
    }, [])

    const handleChange = useCallback(
      (event: StripePaymentElementChangeEvent): void => {
        setIsComplete(event.complete)
        if (event.complete) {
          setMessage(null)
        }
      },
      []
    )

    const handleLoadError = useCallback((): void => {
      if (!hasBeenReadyRef.current) {
        setIsReady(false)
      }
      setMessage(
        "The secure payment form did not load. Check your connection and try again."
      )
    }, [])

    const handleSubmit = useCallback(
      (event: React.FormEvent<HTMLFormElement>): void => {
        void submit(event)
      },
      [submit]
    )

    return (
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="relative min-h-[260px] rounded-2xl border border-border/60 bg-background/70 p-4">
          {!isReady ? (
            <div className="absolute inset-4 space-y-3" aria-hidden="true">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : null}
          {isUpdating && isReady ? (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/85 px-6 text-center text-sm font-semibold text-foreground backdrop-blur-sm"
              role="status"
            >
              Updating your order total…
            </div>
          ) : null}
          <PaymentElement
            options={paymentOptions}
            onLoaderStart={handleLoaderStart}
            onReady={handleReady}
            onChange={handleChange}
            onLoadError={handleLoadError}
          />
        </div>

        <div className="min-h-12" aria-live="polite" aria-atomic="true">
          <CheckoutProblem
            message={message}
            title={
              message?.includes("Do not pay again")
                ? "We’re checking your payment"
                : "Payment needs attention"
            }
          />
        </div>

        <CheckoutDisclosure checkout={checkout} id={disclosureId} />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          aria-describedby={disclosureId}
          disabled={
            !stripe ||
            !elements ||
            !isReady ||
            !isComplete ||
            isSubmitting ||
            isUpdating
          }
        >
          {isSubmitting
            ? "Placing order…"
            : `Place order — ${formatAmount(
                checkout.cart.totals.currencyCode,
                checkout.cart.totals.total
              )}`}
        </Button>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Payment details are securely handled by Stripe.
        </p>
      </form>
    )
  }
)
PaymentElementForm.displayName = "PaymentElementForm"

export const PaymentSection = memo<PaymentSectionProps>(
  ({
    checkout,
    isPreparing,
    prepareError,
    onPrepare,
    onComplete,
    onConfirmed,
    onRecovery,
  }) => {
    const preparedRevisionRef = useRef<string | null>(null)
    const freeOrderDisclosureId = useId()
    const [localPrepareError, setLocalPrepareError] = useState<string | null>(
      null
    )
    const [mountedClientSecret, setMountedClientSecret] = useState<
      string | null
    >(checkout.payment.clientSecret)
    const freeOrderLockRef = useRef(false)
    const lastRevisionRef = useRef(checkout.revision)

    useEffect(() => {
      if (lastRevisionRef.current === checkout.revision) {
        return
      }
      lastRevisionRef.current = checkout.revision
      preparedRevisionRef.current = null
      setLocalPrepareError(null)
    }, [checkout.revision])

    useEffect(() => {
      if (checkout.payment.clientSecret) {
        setMountedClientSecret(checkout.payment.clientSecret)
      }
    }, [checkout.payment.clientSecret])

    const prepare = useCallback(async (): Promise<void> => {
      if (preparedRevisionRef.current === checkout.revision) {
        return
      }
      preparedRevisionRef.current = checkout.revision
      setLocalPrepareError(null)
      try {
        await onPrepare(checkout.revision)
      } catch (error: unknown) {
        preparedRevisionRef.current = null
        setLocalPrepareError(
          error && typeof error === "object" && "problem" in error
            ? (error as CheckoutApiError).problem.detail
            : "Secure payment could not be prepared. Try again."
        )
      }
    }, [checkout.revision, onPrepare])

    useEffect(() => {
      if (
        checkout.cart.totals.total <= 0 ||
        checkout.payment.clientSecret ||
        isPreparing ||
        localPrepareError ||
        preparedRevisionRef.current === checkout.revision
      ) {
        return
      }

      void prepare()
    }, [
      checkout.cart.totals.total,
      checkout.payment.clientSecret,
      checkout.revision,
      isPreparing,
      localPrepareError,
      prepare,
    ])

    const prepareMessage =
      localPrepareError ??
      (prepareError && "problem" in prepareError
        ? (prepareError as CheckoutApiError).problem.detail
        : (prepareError?.message ?? null))
    const [isFreeSubmitting, setIsFreeSubmitting] = useState(false)
    const [freeOrderError, setFreeOrderError] = useState<string | null>(null)

    const submitFreeOrder = async (): Promise<void> => {
      if (freeOrderLockRef.current) {
        return
      }
      freeOrderLockRef.current = true
      setFreeOrderError(null)
      setIsFreeSubmitting(true)
      try {
        await onComplete(checkout.revision)
        onConfirmed(null)
      } catch (error: unknown) {
        if (error && typeof error === "object" && "problem" in error) {
          const problem = (error as CheckoutApiError).problem
          if (
            [
              "completion_in_progress",
              "order_finalizing",
              "payment_processing",
              "payment_result_unknown",
              "recovery_required",
            ].includes(problem.code)
          ) {
            onRecovery()
            return
          }
          setFreeOrderError(problem.detail)
          return
        }
        setFreeOrderError(
          "The order could not be confirmed. Check your connection and try again."
        )
      } finally {
        freeOrderLockRef.current = false
        setIsFreeSubmitting(false)
      }
    }

    if (checkout.cart.totals.total === 0) {
      return (
        <div className="space-y-4">
          <p className="rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
            No payment is due. Confirm the order to finish checkout.
          </p>
          <CheckoutProblem
            message={freeOrderError}
            title="Order was not confirmed"
          />
          <CheckoutDisclosure checkout={checkout} id={freeOrderDisclosureId} />
          <Button
            type="button"
            size="lg"
            className="w-full"
            aria-describedby={freeOrderDisclosureId}
            disabled={isFreeSubmitting}
            onClick={() => void submitFreeOrder()}
          >
            {isFreeSubmitting ? "Placing order…" : "Place free order"}
          </Button>
        </div>
      )
    }

    if (prepareMessage) {
      return (
        <CheckoutProblem
          message={prepareMessage}
          title="Secure payment is unavailable"
          onRetry={() => {
            setLocalPrepareError(null)
            void prepare()
          }}
        />
      )
    }

    const canReuseMountedPayment =
      checkout.payment.provider === "stripe" &&
      (checkout.payment.status === "pending" ||
        checkout.payment.status === "requires_more")
    const effectiveClientSecret =
      checkout.payment.clientSecret ??
      (canReuseMountedPayment ? mountedClientSecret : null)

    if (!effectiveClientSecret) {
      return (
        <div
          className="min-h-[300px] space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4"
          role="status"
        >
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <span className="sr-only">Preparing secure payment…</span>
        </div>
      )
    }

    const elementsOptions: StripeElementsOptions = {
      clientSecret: effectiveClientSecret,
      appearance,
      fonts: [
        {
          cssSrc:
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
        },
      ],
      loader: "auto",
    }

    return (
      <Elements
        key={effectiveClientSecret}
        stripe={getStripePromise()}
        options={elementsOptions}
      >
        <PaymentElementForm
          checkout={checkout}
          isUpdating={isPreparing || !checkout.payment.clientSecret}
          onPrepare={onPrepare}
          onComplete={onComplete}
          onConfirmed={onConfirmed}
          onRecovery={onRecovery}
        />
      </Elements>
    )
  }
)
PaymentSection.displayName = "PaymentSection"
