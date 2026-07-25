"use client"

import { PackageOpen, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { memo, useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import SmartLink from "@/components/ui/smart-link"
import { legalConfig, legalRoutes } from "@/config/legal"
import {
  CheckoutApiError,
  type CheckoutAddressPayload,
  type CheckoutCompletion,
} from "@/features/checkout/api/checkout-api"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import { CheckoutSection } from "@/features/checkout/components/checkout-section"
import { CheckoutSummary } from "@/features/checkout/components/checkout-summary"
import { ContactForm } from "@/features/checkout/components/contact-form"
import { DeliveryAddressForm } from "@/features/checkout/components/delivery-address-form"
import { PaymentSection } from "@/features/checkout/components/payment-section"
import { ShippingMethodList } from "@/features/checkout/components/shipping-method-list"
import { useCheckout } from "@/features/checkout/hooks/use-checkout"
import type {
  CheckoutAddress,
  CheckoutProjection,
} from "@/features/checkout/types/checkout"
import { useCart } from "@/providers/cart-provider"

type EditableStep = "contact" | "delivery" | "shipping" | null

const addressSummary = (address: CheckoutAddress) => (
  <address className="not-italic leading-6">
    <span className="block font-semibold">
      {address.firstName} {address.lastName}
    </span>
    <span className="block">{address.address1}</span>
    {address.address2 ? (
      <span className="block">{address.address2}</span>
    ) : null}
    <span className="block">
      {address.city}, {address.province} {address.postalCode}
    </span>
  </address>
)

const asError = (error: unknown): Error | null =>
  error instanceof Error ? error : null

const checkoutErrorMessage = (error: unknown): string | null => {
  if (error instanceof CheckoutApiError) {
    return error.problem.detail
  }
  return error instanceof Error ? error.message : null
}

const isMissingCart = (error: unknown): boolean =>
  error instanceof CheckoutApiError &&
  ["cart_empty", "cart_missing", "cart_completed"].includes(error.problem.code)

const CheckoutSkeleton = memo(() => (
  <div
    className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8 lg:py-14"
    role="status"
  >
    <div className="space-y-5">
      <Skeleton className="h-16 w-72 max-w-full rounded-2xl" />
      {[1, 2, 3, 4].map((step) => (
        <Skeleton key={step} className="h-44 w-full rounded-3xl" />
      ))}
    </div>
    <Skeleton className="h-[34rem] w-full rounded-3xl" />
    <span className="sr-only">Loading checkout…</span>
  </div>
))
CheckoutSkeleton.displayName = "CheckoutSkeleton"

const EmptyCheckout = memo(() => (
  <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16 sm:px-6">
    <Empty className="w-full py-16">
      <PackageOpen
        className="h-12 w-12 text-destructive"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <EmptyHeader>
        <EmptyTitle>Your cart is empty</EmptyTitle>
        <EmptyDescription>
          Add something from the catalog when you’re ready.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <SmartLink href="/catalog">Browse catalog</SmartLink>
        </Button>
      </EmptyContent>
    </Empty>
  </div>
))
EmptyCheckout.displayName = "EmptyCheckout"

export const CheckoutShell = memo(() => {
  const router = useRouter()
  const { refreshCart } = useCart()
  const {
    checkout,
    checkoutError,
    isLoading,
    refreshCheckout,
    contactMutation,
    deliveryMutation,
    shippingOptions,
    shippingOptionsError,
    isLoadingShippingOptions,
    refreshShippingOptions,
    shippingMutation,
    paymentMutation,
    completionMutation,
  } = useCheckout()
  const [editingStep, setEditingStep] = useState<EditableStep>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)

  useEffect(() => {
    if (!checkout) {
      return
    }
    if (!checkout.cart.contact) {
      setEditingStep("contact")
    } else if (!checkout.cart.deliveryAddress) {
      setEditingStep("delivery")
    } else if (!checkout.cart.shippingMethod) {
      setEditingStep("shipping")
    }
  }, [checkout])

  const saveContact = useCallback(
    async (email: string): Promise<void> => {
      await contactMutation.mutateAsync({ email })
      setEditingStep(null)
    },
    [contactMutation]
  )

  const saveDelivery = useCallback(
    async (address: CheckoutAddressPayload): Promise<void> => {
      await deliveryMutation.mutateAsync({
        shipping_address: address,
        billing_address: address,
      })
      setEditingStep(null)
    },
    [deliveryMutation]
  )

  const saveShipping = useCallback(
    async (optionId: string): Promise<void> => {
      await shippingMutation.mutateAsync(optionId)
      setEditingStep(null)
    },
    [shippingMutation]
  )

  const preparePayment = useCallback(
    async (revision: string): Promise<CheckoutProjection> =>
      paymentMutation.mutateAsync(revision),
    [paymentMutation]
  )

  const complete = useCallback(
    async (revision: string): Promise<CheckoutCompletion> =>
      completionMutation.mutateAsync(revision),
    [completionMutation]
  )

  const showConfirmation = useCallback((): void => {
    void refreshCart().finally(() => {
      router.replace("/checkout/confirmation")
    })
  }, [refreshCart, router])

  const showRecovery = useCallback((): void => {
    router.replace("/checkout/recover")
  }, [router])

  const retryCheckout = useCallback((): void => {
    void refreshCheckout()
  }, [refreshCheckout])

  const contactComplete = Boolean(checkout?.cart.contact)
  const deliveryComplete = Boolean(checkout?.cart.deliveryAddress)
  const selectedShippingMethod = checkout?.cart.shippingMethod
  const shippingComplete = Boolean(
    selectedShippingMethod &&
    !isLoadingShippingOptions &&
    shippingOptions.some(
      (option) =>
        option.id === selectedShippingMethod.optionId &&
        !option.insufficientInventory
    )
  )
  const headerCopy = useMemo(
    () =>
      shippingComplete
        ? "Review the final total, then pay securely."
        : "Complete each step to see your final total.",
    [shippingComplete]
  )

  if (isLoading) {
    return <CheckoutSkeleton />
  }

  if (!checkout && isMissingCart(checkoutError)) {
    return <EmptyCheckout />
  }

  if (!checkout) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16 sm:px-6">
        <CheckoutProblem
          className="w-full"
          title="Checkout could not be loaded"
          message={
            checkoutErrorMessage(checkoutError) ??
            "Checkout is temporarily unavailable."
          }
          onRetry={retryCheckout}
        />
      </div>
    )
  }

  const contact = checkout.cart.contact
  const deliveryAddress = checkout.cart.deliveryAddress
  const shippingMethod = checkout.cart.shippingMethod

  return (
    <div className="w-full overflow-x-clip">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <header className="mb-8 max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22rem] text-destructive">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Secure checkout
          </p>
          <h1 className="mt-3 font-headline text-4xl uppercase tracking-[0.18rem] text-foreground sm:text-5xl">
            Finish your order
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            {headerCopy}
          </p>
        </header>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <div className="min-w-0 space-y-5">
            <CheckoutSummary
              checkout={checkout}
              expanded={summaryExpanded}
              onExpandedChange={setSummaryExpanded}
              className="lg:hidden"
            />

            <CheckoutSection
              step={1}
              title="Contact"
              description="Receipt and shipping updates"
              complete={contactComplete && editingStep !== "contact"}
              summary={contact ? <p>{contact.email}</p> : null}
              onEdit={() => setEditingStep("contact")}
            >
              <ContactForm
                key={contact?.email ?? "new-contact"}
                initialEmail={contact?.email ?? ""}
                isPending={contactMutation.isPending}
                error={asError(contactMutation.error)}
                onSubmit={saveContact}
              />
            </CheckoutSection>

            <CheckoutSection
              step={2}
              title="Delivery address"
              description="Where your order should arrive"
              complete={deliveryComplete && editingStep !== "delivery"}
              disabled={!contactComplete}
              summary={deliveryAddress ? addressSummary(deliveryAddress) : null}
              onEdit={() => setEditingStep("delivery")}
            >
              {contactComplete ? (
                <DeliveryAddressForm
                  key={
                    deliveryAddress
                      ? `${deliveryAddress.address1}-${deliveryAddress.postalCode}`
                      : "new-address"
                  }
                  initialAddress={deliveryAddress}
                  isPending={deliveryMutation.isPending}
                  error={asError(deliveryMutation.error)}
                  onSubmit={saveDelivery}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Save your contact details to continue.
                </p>
              )}
            </CheckoutSection>

            <CheckoutSection
              step={3}
              title="Delivery method"
              description="Available options for this address"
              complete={shippingComplete && editingStep !== "shipping"}
              disabled={!deliveryComplete}
              summary={
                shippingMethod ? (
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold">{shippingMethod.name}</span>
                    <span className="text-muted-foreground">
                      Included in total
                    </span>
                  </div>
                ) : null
              }
              onEdit={() => setEditingStep("shipping")}
            >
              {deliveryComplete ? (
                <ShippingMethodList
                  options={shippingOptions}
                  currentOptionId={shippingMethod?.optionId ?? null}
                  isLoading={isLoadingShippingOptions}
                  isPending={shippingMutation.isPending}
                  error={asError(
                    shippingMutation.error ?? shippingOptionsError
                  )}
                  onRefresh={async () => {
                    await refreshShippingOptions()
                  }}
                  onSelect={saveShipping}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Save your delivery address to continue.
                </p>
              )}
            </CheckoutSection>

            <CheckoutSection
              step={4}
              title="Payment"
              description="Encrypted and processed by Stripe"
              disabled={!shippingComplete}
            >
              {shippingComplete ? (
                <PaymentSection
                  checkout={checkout}
                  isPreparing={paymentMutation.isPending}
                  prepareError={asError(paymentMutation.error)}
                  onPrepare={preparePayment}
                  onComplete={complete}
                  onConfirmed={showConfirmation}
                  onRecovery={showRecovery}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Choose a delivery method to continue.
                </p>
              )}
            </CheckoutSection>

            <p className="px-2 text-center text-xs leading-5 text-muted-foreground">
              By placing your order, you agree to our{" "}
              <SmartLink
                href={legalRoutes.terms}
                className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
              >
                terms
              </SmartLink>
              . Review our{" "}
              <SmartLink
                href={legalRoutes.shipping}
                className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
              >
                shipping
              </SmartLink>{" "}
              and{" "}
              <SmartLink
                href={legalRoutes.returns}
                className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
              >
                return
              </SmartLink>{" "}
              policies. Need help?{" "}
              <a
                href={`mailto:${legalConfig.supportEmail}`}
                className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
              >
                {legalConfig.supportEmail}
              </a>
              .
            </p>
          </div>

          <CheckoutSummary checkout={checkout} className="hidden lg:block" />
        </div>
      </div>
    </div>
  )
})
CheckoutShell.displayName = "CheckoutShell"
