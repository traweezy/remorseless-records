"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Lock, ShoppingBag } from "lucide-react"
import type { Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import type { HttpTypes } from "@medusajs/types"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import SmartLink from "@/components/ui/smart-link"
import { runtimeEnv } from "@/config/env"
import type { StoreCartAddressInput } from "@/lib/cart/types"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"
import { useCart } from "@/providers/cart-provider"

const stripePromise = loadStripe(runtimeEnv.stripePublishableKey)

type StripeState = {
  stripe: Stripe | null
  elements: StripeElements | null
}

const emailSchema = z.string().trim().email("Enter a valid email address.")
const addressSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required."),
  last_name: z.string().trim().min(1, "Last name is required."),
  address_1: z.string().trim().min(1, "Address is required."),
  address_2: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required."),
  province: z.string().trim().optional(),
  postal_code: z.string().trim().min(1, "Postal code is required."),
  country_code: z.string().trim().min(1, "Country is required."),
  phone: z.string().trim().optional(),
})

type AddressFormState = z.infer<typeof addressSchema>

const validateField = (schema: z.ZodTypeAny, message: string) => (value: unknown) =>
  schema.safeParse(value).success ? undefined : message

const emailValidator = validateField(emailSchema, "Enter a valid email address.")
const addressValidators = {
  first_name: validateField(addressSchema.shape.first_name, "First name is required."),
  last_name: validateField(addressSchema.shape.last_name, "Last name is required."),
  address_1: validateField(addressSchema.shape.address_1, "Address is required."),
  city: validateField(addressSchema.shape.city, "City is required."),
  postal_code: validateField(addressSchema.shape.postal_code, "Postal code is required."),
  country_code: validateField(addressSchema.shape.country_code, "Country is required."),
}

const DEFAULT_ADDRESS: AddressFormState = {
  first_name: "",
  last_name: "",
  address_1: "",
  address_2: "",
  city: "",
  province: "",
  postal_code: "",
  country_code: "",
  phone: "",
}

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between text-sm">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-foreground font-semibold">{value}</dd>
  </div>
)

const StepLabel = ({ label, complete }: { label: string; complete: boolean }) => (
  <span className="flex items-center gap-2 text-sm uppercase tracking-[0.3rem]">
    {complete ? (
      <CheckCircle2 className="h-4 w-4 text-accent" />
    ) : (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border/70 text-[0.5rem] text-muted-foreground">
        *
      </span>
    )}
    <span className={cn("font-semibold", complete ? "text-foreground" : "text-muted-foreground")}>{label}</span>
  </span>
)

const extractCountryOptions = (cart: HttpTypes.StoreCart | null) =>
  cart?.region?.countries?.map((country) => ({
    id: country.id ?? country.iso_2 ?? "",
    code: country.iso_2 ?? "",
    label: country.display_name ?? country.name ?? country.iso_2 ?? "",
  })) ?? []

const normalizeAddress = (address: AddressFormState): StoreCartAddressInput => {
  const normalized: StoreCartAddressInput = {
    first_name: address.first_name,
    last_name: address.last_name,
    address_1: address.address_1,
    city: address.city,
    postal_code: address.postal_code,
    country_code: address.country_code,
  }

  const province = address.province?.trim()
  if (province) {
    normalized.province = province
  }

  const address2 = address.address_2?.trim()
  if (address2) {
    normalized.address_2 = address2
  }

  const phone = address.phone?.trim()
  if (phone) {
    normalized.phone = phone
  }

  return normalized
}

const buildTaxKey = (
  address: HttpTypes.StoreCartAddress | null | undefined,
  shippingOptionId: string | null
): string | null => {
  if (!address || !shippingOptionId) {
    return null
  }

  const country = address.country_code?.trim().toLowerCase()
  const postal = address.postal_code?.trim()
  if (!country || !postal) {
    return null
  }

  const province = (address.province ?? "").trim().toLowerCase()
  return `${country}:${province}:${postal}:${shippingOptionId}`
}

const StripePaymentElement = ({
  clientSecret,
  onReady,
}: {
  clientSecret: string
  onReady: (state: StripeState) => void
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    let element: StripePaymentElement | null = null

    const mount = async () => {
      if (!containerRef.current) return

      const stripe = await stripePromise
      if (!stripe) {
        return
      }

      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: "night",
        },
      })

      element = elements.create("payment", {
        layout: "accordion",
        paymentMethodOrder: ["card"],
        wallets: {
          applePay: "never",
          googlePay: "never",
          link: "never",
        },
      })
      element.mount(containerRef.current)

      if (mounted) {
        onReady({ stripe, elements })
      }
    }

    void mount()

    return () => {
      mounted = false
      element?.destroy()
    }
  }, [clientSecret, onReady])

  return <div ref={containerRef} className="min-h-[240px]" />
}

const CheckoutPage = () => {
  const router = useRouter()
  const {
    cart,
    isLoading,
    itemCount,
    subtotal,
    taxTotal,
    shippingTotal,
    discountTotal,
    total,
    setEmail,
    setAddresses,
    listShippingOptions,
    addShippingMethod,
    calculateTaxes,
    initPaymentSessions,
    completeCart,
  } = useCart()

  const [activeStep, setActiveStep] = useState("contact")
  const [contactComplete, setContactComplete] = useState(false)
  const [shippingSubmitted, setShippingSubmitted] = useState(false)
  const [shippingOptions, setShippingOptions] = useState<HttpTypes.StoreCartShippingOptionWithServiceZone[]>([])
  const [selectedShippingOption, setSelectedShippingOption] = useState<string>("")
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [isSavingAddress, setIsSavingAddress] = useState(false)
  const [isLoadingShipping, setIsLoadingShipping] = useState(false)
  const [isCalculatingTaxes, setIsCalculatingTaxes] = useState(false)
  const [taxError, setTaxError] = useState<string | null>(null)
  const [taxKey, setTaxKey] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripeState, setStripeState] = useState<StripeState>({ stripe: null, elements: null })
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)

  const contactForm = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      setIsSavingContact(true)
      const updated = await setEmail(value.email.trim())
      setIsSavingContact(false)

      if (updated?.email) {
        setContactComplete(true)
        setActiveStep("shipping")
      }
    },
  })

  const shippingForm = useForm({
    defaultValues: {
      shipping: DEFAULT_ADDRESS,
      billingSame: true,
      billing: DEFAULT_ADDRESS,
    },
    onSubmit: async ({ value }) => {
      setIsSavingAddress(true)
      const updated = await setAddresses({
        shipping_address: normalizeAddress(value.shipping),
        billing_address: value.billingSame
          ? normalizeAddress(value.shipping)
          : normalizeAddress(value.billing),
      })
      setIsSavingAddress(false)

      if (updated?.shipping_address) {
        setShippingSubmitted(true)
        setTaxKey(null)
        setTaxError(null)
      }
    },
  })

  const billingSame = shippingForm.state.values.billingSame

  const currentTaxKey = useMemo(
    () => buildTaxKey(cart?.shipping_address, selectedShippingOption || null),
    [cart?.shipping_address, selectedShippingOption]
  )
  const hasCalculatedTaxes = Boolean(currentTaxKey && taxKey === currentTaxKey)
  const shippingComplete = contactComplete && shippingSubmitted && hasCalculatedTaxes
  const canOpenShipping = contactComplete
  const canOpenPayment = shippingComplete
  const standardShippingOption = useMemo(
    () => (shippingOptions.length === 1 ? shippingOptions[0] : null),
    [shippingOptions]
  )

  const handleStepChange = useCallback(
    (value: string) => {
      if (!value) return
      if (value === "shipping" && !canOpenShipping) return
      if (value === "payment" && !canOpenPayment) return
      setActiveStep(value)
    },
    [canOpenPayment, canOpenShipping]
  )

  const invalidateContact = useCallback(() => {
    if (contactComplete) {
      setContactComplete(false)
    }
  }, [contactComplete])

  const invalidateShipping = useCallback(() => {
    if (!shippingSubmitted) return
    setShippingSubmitted(false)
    setTaxKey(null)
    setTaxError(null)
  }, [shippingSubmitted])

  useEffect(() => {
    if (!isLoading && (!cart || !cart.items?.length)) {
      router.replace("/cart")
    }
  }, [cart, isLoading, router])

  useEffect(() => {
    if (!currentTaxKey) {
      setTaxKey(null)
      setTaxError(null)
      setIsCalculatingTaxes(false)
      return
    }

    if (taxKey && taxKey !== currentTaxKey) {
      setTaxError(null)
    }
  }, [currentTaxKey, taxKey])

  const loadShippingOptions = useCallback(
    async (currentCartId: string) => {
      setIsLoadingShipping(true)
      try {
        const options = await listShippingOptions(currentCartId)
        setShippingOptions(options)
      } catch (loadError) {
        console.error("Failed to load shipping options", loadError)
        setShippingOptions([])
      } finally {
        setIsLoadingShipping(false)
      }
    },
    [listShippingOptions]
  )

  useEffect(() => {
    if (cart?.id && cart.shipping_address && shippingSubmitted) {
      void loadShippingOptions(cart.id)
    }
  }, [cart?.id, cart?.shipping_address, loadShippingOptions, shippingSubmitted])

  const resetPaymentState = useCallback(() => {
    setClientSecret(null)
    setStripeState({ stripe: null, elements: null })
  }, [])

  useEffect(() => {
    resetPaymentState()
  }, [cart?.id, cart?.shipping_methods, cart?.total, resetPaymentState])

  useEffect(() => {
    if (contactComplete && shippingSubmitted && hasCalculatedTaxes) {
      setActiveStep("payment")
    }
  }, [contactComplete, hasCalculatedTaxes, shippingSubmitted])

  useEffect(() => {
    if (!contactComplete && activeStep !== "contact") {
      setActiveStep("contact")
      return
    }
    if (contactComplete && !shippingComplete && activeStep === "payment") {
      setActiveStep("shipping")
    }
  }, [activeStep, contactComplete, shippingComplete])

  const runTaxCalculation = useCallback(
    async (overrideKey?: string | null) => {
      const cartId = cart?.id
      const resolvedKey = overrideKey ?? currentTaxKey

      if (!cartId || !resolvedKey) {
        setTaxError("Add a shipping address and method to calculate taxes.")
        return null
      }

      setIsCalculatingTaxes(true)
      setTaxError(null)

      try {
        const updated = await calculateTaxes()

        if (updated?.id) {
          setTaxKey(resolvedKey)
          return updated
        }

        setTaxError("Unable to calculate taxes. Please try again.")
        return null
      } catch (error) {
        console.error("Failed to calculate taxes", error)
        setTaxError("Unable to calculate taxes. Please try again.")
        return null
      } finally {
        setIsCalculatingTaxes(false)
      }
    },
    [calculateTaxes, cart?.id, currentTaxKey]
  )

  const maybeInitPaymentSession = useCallback(async () => {
    const canInitPayment =
      Boolean(cart?.id) &&
      contactComplete &&
      shippingSubmitted &&
      Boolean(cart?.email) &&
      Boolean(cart?.shipping_address) &&
      Boolean(cart?.shipping_methods?.length) &&
      hasCalculatedTaxes &&
      Number(cart?.total ?? 0) > 0

    if (!canInitPayment || clientSecret) {
      return
    }

    try {
      const session = await initPaymentSessions()
      if (session.clientSecret) {
        setClientSecret(session.clientSecret)
      }
    } catch (sessionError) {
      console.error("Failed to initialize payment session", sessionError)
    }
  }, [cart, clientSecret, contactComplete, hasCalculatedTaxes, initPaymentSessions, shippingSubmitted])

  useEffect(() => {
    void maybeInitPaymentSession()
  }, [maybeInitPaymentSession])

  const countryOptions = useMemo(() => extractCountryOptions(cart ?? null), [cart])

  const summaryTotal = total ?? 0
  const currencyCode = cart?.currency_code ?? "usd"

  const resolveMoney = useCallback(
    (value: number | null, fallback: string) =>
      value === null || value === undefined ? fallback : formatAmount(currencyCode, value),
    [currencyCode]
  )

  const handleShippingSelect = useCallback(
    async (optionId: string) => {
      setSelectedShippingOption(optionId)
      const updatedCart = await addShippingMethod(optionId)
      const nextKey = buildTaxKey(
        updatedCart?.shipping_address ?? cart?.shipping_address,
        optionId
      )
      await runTaxCalculation(nextKey)
    },
    [addShippingMethod, cart?.shipping_address, runTaxCalculation]
  )

  useEffect(() => {
    if (!shippingSubmitted) return
    if (!standardShippingOption || isLoadingShipping) return
    if (selectedShippingOption === standardShippingOption.id && hasCalculatedTaxes) return
    if (cart?.shipping_methods?.[0]?.shipping_option_id === standardShippingOption.id) {
      setSelectedShippingOption(standardShippingOption.id)
      if (!hasCalculatedTaxes) {
        void handleShippingSelect(standardShippingOption.id)
      }
      return
    }
    void handleShippingSelect(standardShippingOption.id)
  }, [
    cart?.shipping_methods,
    handleShippingSelect,
    hasCalculatedTaxes,
    isLoadingShipping,
    selectedShippingOption,
    shippingSubmitted,
    standardShippingOption,
  ])

  const handlePlaceOrder = async () => {
    if (!cart?.id) return

    if (!hasCalculatedTaxes) {
      setTaxError("Complete shipping so taxes can be calculated before placing your order.")
      return
    }

    setPaymentError(null)
    setIsPlacingOrder(true)

    if (Number(cart.total ?? 0) <= 0) {
      const result = await completeCart()
      setIsPlacingOrder(false)
      if (result?.type === "order") {
        router.replace(`/checkout/success?order_id=${result.order.id}&display_id=${result.order.display_id ?? ""}`)
      } else {
        setPaymentError(result?.error?.message ?? "Unable to place order.")
      }
      return
    }

    if (!stripeState.stripe || !stripeState.elements) {
      setPaymentError("Payment form is still loading. Please wait.")
      setIsPlacingOrder(false)
      return
    }

    const returnUrl = `${window.location.origin}/checkout/success?cart_id=${cart.id}`

    const result = await stripeState.stripe.confirmPayment({
      elements: stripeState.elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    })

    if (result.error) {
      setPaymentError(result.error.message ?? "Payment failed. Please try again.")
      setIsPlacingOrder(false)
      return
    }

    if (result.paymentIntent?.status === "processing" || result.paymentIntent?.status === "succeeded") {
      const completed = await completeCart()
      setIsPlacingOrder(false)

      if (completed?.type === "order") {
        router.replace(`/checkout/success?order_id=${completed.order.id}&display_id=${completed.order.display_id ?? ""}`)
        return
      }

      setPaymentError(completed?.error?.message ?? "Unable to finalize the order.")
      return
    }

    setPaymentError("Payment requires additional steps. Follow the prompts to continue.")
    setIsPlacingOrder(false)
  }

  if (isLoading && !cart) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-16">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Skeleton className="h-[520px] w-full" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      </div>
    )
  }

  if (!cart || !cart.items?.length) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center">
        <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        <h1 className="font-display text-3xl uppercase tracking-[0.3rem] text-foreground">
          Your cart is empty
        </h1>
        <p className="text-sm text-muted-foreground">
          Add something before starting checkout.
        </p>
        <SmartLink
          href="/cart"
          nativePrefetch
          className="inline-flex min-h-[44px] items-center rounded-full border border-accent px-6 text-xs font-semibold uppercase tracking-[0.3rem] text-accent"
        >
          Return to cart
        </SmartLink>
      </div>
    )
  }

  const shippingEstimate =
    shippingSubmitted && cart.shipping_methods?.length
      ? resolveMoney(shippingTotal, formatAmount(currencyCode, 0))
      : "Calculated at next step"
  const taxEstimate = hasCalculatedTaxes
    ? resolveMoney(taxTotal, formatAmount(currencyCode, 0))
    : "Estimated at next step"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl uppercase tracking-[0.35rem] text-foreground">
            Checkout
          </h1>
          <p className="text-sm text-muted-foreground">
            Complete your order in a few focused steps.
          </p>
        </div>
        <SmartLink
          href="/cart"
          nativePrefetch
          className="inline-flex items-center gap-2 rounded-full border border-border/60 px-4 py-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground hover:border-accent hover:text-accent"
        >
          Back to cart
        </SmartLink>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Checkout Steps</CardTitle>
            <CardDescription>Everything saves to your cart as you go.</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion
              type="single"
              collapsible
              value={activeStep}
              onValueChange={handleStepChange}
              className="space-y-4"
            >
              <AccordionItem value="contact" className="border-none">
                <AccordionTrigger className="rounded-2xl border border-border/60 px-4">
                  <StepLabel label="Contact" complete={contactComplete} />
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <form
                    className="space-y-4"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void contactForm.handleSubmit()
                    }}
                  >
                    <contactForm.Field
                      name="email"
                      validators={{
                        onChange: ({ value }) => emailValidator(value),
                        onSubmit: ({ value }) => emailValidator(value),
                      }}
                    >
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Email</Label>
                          <Input
                            id={field.name}
                            type="email"
                            autoComplete="email"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              invalidateContact()
                            }}
                            onBlur={field.handleBlur}
                            aria-invalid={Boolean(field.state.meta.errors[0])}
                            aria-describedby={field.state.meta.errors[0] ? `${field.name}-error` : undefined}
                          />
                          {field.state.meta.errors[0] ? (
                            <p id={`${field.name}-error`} className="text-xs text-destructive">
                              {field.state.meta.errors[0]}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </contactForm.Field>
                    <Button type="submit" className="w-full" disabled={isSavingContact}>
                      {isSavingContact ? "Saving..." : "Continue to shipping"}
                    </Button>
                  </form>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="shipping" className="border-none">
                <AccordionTrigger
                  className="rounded-2xl border border-border/60 px-4 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canOpenShipping}
                >
                  <StepLabel label="Shipping" complete={shippingComplete} />
                </AccordionTrigger>
                <AccordionContent>
                  <form
                    className="space-y-6"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void shippingForm.handleSubmit()
                    }}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <shippingForm.Field
                        name="shipping.first_name"
                        validators={{
                          onChange: ({ value }) => addressValidators.first_name(value),
                          onSubmit: ({ value }) => addressValidators.first_name(value),
                        }}
                      >
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>First name</Label>
                            <Input
                              id={field.name}
                              autoComplete="given-name"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.target.value)
                                invalidateShipping()
                              }}
                              onBlur={field.handleBlur}
                              aria-invalid={Boolean(field.state.meta.errors[0])}
                            />
                            {field.state.meta.errors[0] ? (
                              <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                            ) : null}
                          </div>
                        )}
                      </shippingForm.Field>
                      <shippingForm.Field
                        name="shipping.last_name"
                        validators={{
                          onChange: ({ value }) => addressValidators.last_name(value),
                          onSubmit: ({ value }) => addressValidators.last_name(value),
                        }}
                      >
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Last name</Label>
                            <Input
                              id={field.name}
                              autoComplete="family-name"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.target.value)
                                invalidateShipping()
                              }}
                              onBlur={field.handleBlur}
                              aria-invalid={Boolean(field.state.meta.errors[0])}
                            />
                            {field.state.meta.errors[0] ? (
                              <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                            ) : null}
                          </div>
                        )}
                      </shippingForm.Field>
                    </div>

                    <shippingForm.Field
                      name="shipping.address_1"
                      validators={{
                        onChange: ({ value }) => addressValidators.address_1(value),
                        onSubmit: ({ value }) => addressValidators.address_1(value),
                      }}
                    >
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Address</Label>
                          <Input
                            id={field.name}
                            autoComplete="shipping address-line1"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              invalidateShipping()
                            }}
                            onBlur={field.handleBlur}
                            aria-invalid={Boolean(field.state.meta.errors[0])}
                          />
                          {field.state.meta.errors[0] ? (
                            <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                          ) : null}
                        </div>
                      )}
                    </shippingForm.Field>

                    <shippingForm.Field name="shipping.address_2">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Apartment, suite, etc.</Label>
                          <Input
                            id={field.name}
                            autoComplete="shipping address-line2"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              invalidateShipping()
                            }}
                            onBlur={field.handleBlur}
                          />
                        </div>
                      )}
                    </shippingForm.Field>

                    <div className="grid gap-4 md:grid-cols-2">
                      <shippingForm.Field
                        name="shipping.city"
                        validators={{
                          onChange: ({ value }) => addressValidators.city(value),
                          onSubmit: ({ value }) => addressValidators.city(value),
                        }}
                      >
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>City</Label>
                            <Input
                              id={field.name}
                              autoComplete="shipping address-level2"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.target.value)
                                invalidateShipping()
                              }}
                              onBlur={field.handleBlur}
                              aria-invalid={Boolean(field.state.meta.errors[0])}
                            />
                            {field.state.meta.errors[0] ? (
                              <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                            ) : null}
                          </div>
                        )}
                      </shippingForm.Field>
                      <shippingForm.Field name="shipping.province">
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>State / Province</Label>
                            <Input
                              id={field.name}
                              autoComplete="shipping address-level1"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.target.value)
                                invalidateShipping()
                              }}
                              onBlur={field.handleBlur}
                            />
                          </div>
                        )}
                      </shippingForm.Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <shippingForm.Field
                        name="shipping.postal_code"
                        validators={{
                          onChange: ({ value }) => addressValidators.postal_code(value),
                          onSubmit: ({ value }) => addressValidators.postal_code(value),
                        }}
                      >
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Postal code</Label>
                            <Input
                              id={field.name}
                              autoComplete="shipping postal-code"
                              value={field.state.value}
                              onChange={(event) => {
                                field.handleChange(event.target.value)
                                invalidateShipping()
                              }}
                              onBlur={field.handleBlur}
                              aria-invalid={Boolean(field.state.meta.errors[0])}
                            />
                            {field.state.meta.errors[0] ? (
                              <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                            ) : null}
                          </div>
                        )}
                      </shippingForm.Field>
                      <shippingForm.Field
                        name="shipping.country_code"
                        validators={{
                          onChange: ({ value }) => addressValidators.country_code(value),
                          onSubmit: ({ value }) => addressValidators.country_code(value),
                        }}
                      >
                        {(field) => (
                          <div className="space-y-2">
                            <Label htmlFor={field.name}>Country</Label>
                            <Select
                              value={field.state.value}
                              onValueChange={(value) => {
                                field.handleChange(value)
                                invalidateShipping()
                              }}
                            >
                              <SelectTrigger id={field.name} aria-invalid={Boolean(field.state.meta.errors[0])}>
                                <SelectValue placeholder="Select country" />
                              </SelectTrigger>
                              <SelectContent>
                                {countryOptions.map((country) => (
                                  <SelectItem key={country.id} value={country.code}>
                                    {country.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {field.state.meta.errors[0] ? (
                              <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                            ) : null}
                          </div>
                        )}
                      </shippingForm.Field>
                    </div>

                    <shippingForm.Field name="shipping.phone">
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>Phone</Label>
                          <Input
                            id={field.name}
                            type="tel"
                            autoComplete="shipping tel"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.target.value)
                              invalidateShipping()
                            }}
                            onBlur={field.handleBlur}
                          />
                        </div>
                      )}
                    </shippingForm.Field>

                    <div className="flex items-center gap-3">
                      <shippingForm.Field name="billingSame">
                        {(field) => (
                          <>
                            <Checkbox
                              id="billing-same"
                              checked={field.state.value}
                              onCheckedChange={(value) => {
                                field.handleChange(Boolean(value))
                                invalidateShipping()
                              }}
                            />
                            <Label htmlFor="billing-same" className="text-xs uppercase tracking-[0.3rem]">
                              Billing address is the same
                            </Label>
                          </>
                        )}
                      </shippingForm.Field>
                    </div>

                    {!billingSame ? (
                      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                        <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                          Billing address
                        </p>
                        <div className="grid gap-4 md:grid-cols-2">
                          <shippingForm.Field
                            name="billing.first_name"
                            validators={{
                              onChange: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.first_name(value),
                              onSubmit: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.first_name(value),
                            }}
                          >
                            {(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>First name</Label>
                                <Input
                                  id={field.name}
                                  autoComplete="billing given-name"
                                  value={field.state.value}
                                  onChange={(event) => {
                                    field.handleChange(event.target.value)
                                    invalidateShipping()
                                  }}
                                  onBlur={field.handleBlur}
                                  aria-invalid={Boolean(field.state.meta.errors[0])}
                                />
                                {field.state.meta.errors[0] ? (
                                  <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                                ) : null}
                              </div>
                            )}
                          </shippingForm.Field>
                          <shippingForm.Field
                            name="billing.last_name"
                            validators={{
                              onChange: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.last_name(value),
                              onSubmit: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.last_name(value),
                            }}
                          >
                            {(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>Last name</Label>
                                <Input
                                  id={field.name}
                                  autoComplete="billing family-name"
                                  value={field.state.value}
                                  onChange={(event) => {
                                    field.handleChange(event.target.value)
                                    invalidateShipping()
                                  }}
                                  onBlur={field.handleBlur}
                                  aria-invalid={Boolean(field.state.meta.errors[0])}
                                />
                                {field.state.meta.errors[0] ? (
                                  <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                                ) : null}
                              </div>
                            )}
                          </shippingForm.Field>
                        </div>
                        <shippingForm.Field
                          name="billing.address_1"
                          validators={{
                            onChange: ({ value }) =>
                              billingSame
                                ? undefined
                                : addressValidators.address_1(value),
                            onSubmit: ({ value }) =>
                              billingSame
                                ? undefined
                                : addressValidators.address_1(value),
                          }}
                        >
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor={field.name}>Address</Label>
                              <Input
                                id={field.name}
                                autoComplete="billing address-line1"
                                value={field.state.value}
                                onChange={(event) => {
                                  field.handleChange(event.target.value)
                                  invalidateShipping()
                                }}
                                onBlur={field.handleBlur}
                                aria-invalid={Boolean(field.state.meta.errors[0])}
                              />
                              {field.state.meta.errors[0] ? (
                                <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                              ) : null}
                            </div>
                          )}
                        </shippingForm.Field>
                        <shippingForm.Field
                          name="billing.city"
                          validators={{
                            onChange: ({ value }) =>
                              billingSame
                                ? undefined
                                : addressValidators.city(value),
                            onSubmit: ({ value }) =>
                              billingSame
                                ? undefined
                                : addressValidators.city(value),
                          }}
                        >
                          {(field) => (
                            <div className="space-y-2">
                              <Label htmlFor={field.name}>City</Label>
                              <Input
                                id={field.name}
                                autoComplete="billing address-level2"
                                value={field.state.value}
                                onChange={(event) => {
                                  field.handleChange(event.target.value)
                                  invalidateShipping()
                                }}
                                onBlur={field.handleBlur}
                                aria-invalid={Boolean(field.state.meta.errors[0])}
                              />
                              {field.state.meta.errors[0] ? (
                                <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                              ) : null}
                            </div>
                          )}
                        </shippingForm.Field>
                        <div className="grid gap-4 md:grid-cols-2">
                          <shippingForm.Field
                            name="billing.postal_code"
                            validators={{
                              onChange: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.postal_code(value),
                              onSubmit: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.postal_code(value),
                            }}
                          >
                            {(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>Postal code</Label>
                                <Input
                                  id={field.name}
                                  autoComplete="billing postal-code"
                                  value={field.state.value}
                                  onChange={(event) => {
                                    field.handleChange(event.target.value)
                                    invalidateShipping()
                                  }}
                                  onBlur={field.handleBlur}
                                  aria-invalid={Boolean(field.state.meta.errors[0])}
                                />
                                {field.state.meta.errors[0] ? (
                                  <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                                ) : null}
                              </div>
                            )}
                          </shippingForm.Field>
                          <shippingForm.Field
                            name="billing.country_code"
                            validators={{
                              onChange: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.country_code(value),
                              onSubmit: ({ value }) =>
                                billingSame
                                  ? undefined
                                  : addressValidators.country_code(value),
                            }}
                          >
                            {(field) => (
                              <div className="space-y-2">
                                <Label htmlFor={field.name}>Country</Label>
                                <Select
                                  value={field.state.value}
                                  onValueChange={(value) => {
                                    field.handleChange(value)
                                    invalidateShipping()
                                  }}
                                >
                                  <SelectTrigger id={field.name} aria-invalid={Boolean(field.state.meta.errors[0])}>
                                    <SelectValue placeholder="Select country" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {countryOptions.map((country) => (
                                      <SelectItem key={`billing-${country.id}`} value={country.code}>
                                        {country.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {field.state.meta.errors[0] ? (
                                  <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                                ) : null}
                              </div>
                            )}
                          </shippingForm.Field>
                        </div>
                      </div>
                    ) : null}

                    <Separator className="border-border/60" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                          Shipping method
                        </p>
                        {isLoadingShipping ? (
                          <span className="text-xs text-muted-foreground">Loading options...</span>
                        ) : null}
                      </div>
                      {!shippingSubmitted ? (
                        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-xs text-muted-foreground">
                          Shipping appears after saving your address.
                        </div>
                      ) : standardShippingOption ? (
                        <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm">
                          <span className="font-medium text-foreground">
                            {standardShippingOption.name}
                          </span>
                          <span className="text-muted-foreground">
                            {formatAmount(currencyCode, Number(standardShippingOption.amount ?? 0))}
                          </span>
                        </div>
                      ) : cart?.shipping_methods?.length ? (
                        <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm">
                          <span className="font-medium text-foreground">Standard Shipping</span>
                          <span className="text-muted-foreground">
                            {formatAmount(currencyCode, Number(cart.shipping_methods?.[0]?.amount ?? 0))}
                          </span>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-xs text-muted-foreground">
                          Shipping appears after saving your address.
                        </div>
                      )}
                    </div>

                    <Button type="submit" className="w-full" disabled={isSavingAddress}>
                      {isSavingAddress ? "Saving..." : "Continue to payment"}
                    </Button>
                  </form>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="payment" className="border-none">
                <AccordionTrigger
                  className="rounded-2xl border border-border/60 px-4 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canOpenPayment}
                >
                  <StepLabel label="Payment" complete={false} />
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  {!hasCalculatedTaxes ? (
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                      {isCalculatingTaxes
                        ? "Calculating taxes based on your shipping details..."
                        : "Taxes are calculated automatically after shipping is saved."}
                    </div>
                  ) : null}

                  {taxError ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {taxError}
                    </div>
                  ) : null}

                  {Number(cart?.total ?? 0) <= 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                      This order is free. Confirm to place it now.
                    </div>
                  ) : clientSecret ? (
                    <StripePaymentElement
                      clientSecret={clientSecret}
                      onReady={setStripeState}
                    />
                  ) : (
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-40" />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  )}

                  {paymentError ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {paymentError}
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handlePlaceOrder()}
                    disabled={
                      isPlacingOrder ||
                      isCalculatingTaxes ||
                      !hasCalculatedTaxes ||
                      (Number(cart?.total ?? 0) > 0 && !clientSecret)
                    }
                  >
                    {isPlacingOrder ? "Placing order..." : "Place order"}
                  </Button>

                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Payments are encrypted and processed securely.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
            <CardDescription>{itemCount} item{itemCount === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {cart.items?.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-foreground">{item.title}</p>
                    <p className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                      Qty {item.quantity}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {formatAmount(currencyCode, Number(item.total ?? item.subtotal ?? 0))}
                  </p>
                </div>
              ))}
            </div>
            <Separator className="border-border/60" />
            <dl className="space-y-3">
              <SummaryRow label="Subtotal" value={formatAmount(currencyCode, Number(subtotal ?? 0))} />
              <SummaryRow label="Shipping" value={shippingEstimate} />
              <SummaryRow label="Tax" value={taxEstimate} />
              {discountTotal && discountTotal > 0 ? (
                <SummaryRow label="Discount" value={`-${formatAmount(currencyCode, discountTotal)}`} />
              ) : null}
              <Separator className="border-border/60" />
              <SummaryRow label="Total" value={formatAmount(currencyCode, summaryTotal)} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default CheckoutPage
