"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Lock, ShoppingBag } from "lucide-react"
import type { Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import type { HttpTypes } from "@medusajs/types"

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

type AddressFormState = {
  first_name: string
  last_name: string
  address_1: string
  address_2: string
  city: string
  province: string
  postal_code: string
  country_code: string
  phone: string
}

type FormErrors = Record<string, string>

type StripeState = {
  stripe: Stripe | null
  elements: StripeElements | null
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
    province: address.province,
    postal_code: address.postal_code,
    country_code: address.country_code,
  }

  if (address.address_2.trim()) {
    normalized.address_2 = address.address_2
  }

  if (address.phone.trim()) {
    normalized.phone = address.phone
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

const validateEmail = (email: string): string | null => {
  if (!email.trim()) {
    return "Email is required."
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return "Enter a valid email address."
  }

  return null
}

const validateAddress = (address: AddressFormState): FormErrors => {
  const errors: FormErrors = {}
  if (!address.first_name.trim()) errors.first_name = "First name is required."
  if (!address.last_name.trim()) errors.last_name = "Last name is required."
  if (!address.address_1.trim()) errors.address_1 = "Address is required."
  if (!address.city.trim()) errors.city = "City is required."
  if (!address.postal_code.trim()) errors.postal_code = "Postal code is required."
  if (!address.country_code.trim()) errors.country_code = "Country is required."
  return errors
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

      element = elements.create("payment", { layout: "tabs" })
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
  const [email, setEmailState] = useState("")
  const [contactError, setContactError] = useState<string | null>(null)
  const [shippingAddress, setShippingAddress] = useState<AddressFormState>(DEFAULT_ADDRESS)
  const [billingAddress, setBillingAddress] = useState<AddressFormState>(DEFAULT_ADDRESS)
  const [billingSame, setBillingSame] = useState(true)
  const [addressErrors, setAddressErrors] = useState<FormErrors>({})
  const [billingErrors, setBillingErrors] = useState<FormErrors>({})
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

  const contactComplete = Boolean(cart?.email)
  const shippingComplete = Boolean(cart?.shipping_address && cart?.shipping_methods?.length)
  const canOpenShipping = contactComplete
  const canOpenPayment = shippingComplete
  const currentTaxKey = useMemo(
    () => buildTaxKey(cart?.shipping_address, selectedShippingOption || null),
    [cart?.shipping_address, selectedShippingOption]
  )
  const hasCalculatedTaxes = Boolean(currentTaxKey && taxKey === currentTaxKey)
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

  const syncFromCart = useCallback((currentCart: HttpTypes.StoreCart, existingEmail: string) => {
    if (currentCart.email && !existingEmail) {
      setEmailState(currentCart.email)
    }

    if (currentCart.shipping_address) {
      setShippingAddress((prev) => ({
        ...prev,
        first_name: currentCart.shipping_address?.first_name ?? prev.first_name,
        last_name: currentCart.shipping_address?.last_name ?? prev.last_name,
        address_1: currentCart.shipping_address?.address_1 ?? prev.address_1,
        address_2: currentCart.shipping_address?.address_2 ?? prev.address_2,
        city: currentCart.shipping_address?.city ?? prev.city,
        province: currentCart.shipping_address?.province ?? prev.province,
        postal_code: currentCart.shipping_address?.postal_code ?? prev.postal_code,
        country_code: currentCart.shipping_address?.country_code ?? prev.country_code,
        phone: currentCart.shipping_address?.phone ?? prev.phone,
      }))
    }

    if (currentCart.billing_address) {
      setBillingSame(false)
      setBillingAddress((prev) => ({
        ...prev,
        first_name: currentCart.billing_address?.first_name ?? prev.first_name,
        last_name: currentCart.billing_address?.last_name ?? prev.last_name,
        address_1: currentCart.billing_address?.address_1 ?? prev.address_1,
        address_2: currentCart.billing_address?.address_2 ?? prev.address_2,
        city: currentCart.billing_address?.city ?? prev.city,
        province: currentCart.billing_address?.province ?? prev.province,
        postal_code: currentCart.billing_address?.postal_code ?? prev.postal_code,
        country_code: currentCart.billing_address?.country_code ?? prev.country_code,
        phone: currentCart.billing_address?.phone ?? prev.phone,
      }))
    }

    const existingOption = currentCart.shipping_methods?.[0]?.shipping_option_id
    if (existingOption) {
      setSelectedShippingOption(existingOption)
    }
  }, [])

  useEffect(() => {
    if (!cart) return
    syncFromCart(cart, email)
  }, [cart, email, syncFromCart])

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
    if (cart?.id && cart.shipping_address) {
      void loadShippingOptions(cart.id)
    }
  }, [cart?.id, cart?.shipping_address, loadShippingOptions])

  const resetPaymentState = useCallback(() => {
    setClientSecret(null)
    setStripeState({ stripe: null, elements: null })
  }, [])

  useEffect(() => {
    resetPaymentState()
  }, [cart?.id, cart?.shipping_methods, cart?.total, resetPaymentState])

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
  }, [cart, clientSecret, hasCalculatedTaxes, initPaymentSessions])

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

  const handleContactSubmit = async () => {
    const error = validateEmail(email)
    setContactError(error)
    if (error) return

    setIsSavingContact(true)
    const updated = await setEmail(email)
    setIsSavingContact(false)

    if (updated?.email) {
      setActiveStep("shipping")
    }
  }

  const handleAddressSubmit = async () => {
    const shippingValidation = validateAddress(shippingAddress)
    const billingValidation = billingSame ? {} : validateAddress(billingAddress)

    setAddressErrors(shippingValidation)
    setBillingErrors(billingValidation)

    if (Object.keys(shippingValidation).length || Object.keys(billingValidation).length) {
      return
    }

    setIsSavingAddress(true)
    const updated = await setAddresses({
      shipping_address: normalizeAddress(shippingAddress),
      billing_address: billingSame ? normalizeAddress(shippingAddress) : normalizeAddress(billingAddress),
    })
    setIsSavingAddress(false)

    if (updated?.shipping_address) {
      setTaxKey(null)
      setTaxError(null)
      if (updated?.shipping_methods?.length) {
        setActiveStep("payment")
      }
    }
  }

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
    if (!standardShippingOption || isLoadingShipping) return
    if (selectedShippingOption === standardShippingOption.id) return
    if (cart?.shipping_methods?.[0]?.shipping_option_id === standardShippingOption.id) {
      setSelectedShippingOption(standardShippingOption.id)
      return
    }
    void handleShippingSelect(standardShippingOption.id)
  }, [
    cart?.shipping_methods,
    handleShippingSelect,
    isLoadingShipping,
    selectedShippingOption,
    standardShippingOption,
  ])

  const handlePlaceOrder = async () => {
    if (!cart?.id) return

    if (!hasCalculatedTaxes) {
      setTaxError("Please calculate taxes before placing your order.")
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

  const shippingEstimate = resolveMoney(
    shippingTotal,
    cart.shipping_methods?.length ? formatAmount(currencyCode, 0) : "Calculated at next step"
  )
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
                  <div className="space-y-2">
                    <Label htmlFor="checkout-email">Email</Label>
                    <Input
                      id="checkout-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmailState(event.target.value)}
                      onBlur={() => setContactError(validateEmail(email))}
                      aria-invalid={Boolean(contactError)}
                      aria-describedby={contactError ? "checkout-email-error" : undefined}
                    />
                    {contactError ? (
                      <p id="checkout-email-error" className="text-xs text-destructive">
                        {contactError}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleContactSubmit()}
                    disabled={isSavingContact}
                  >
                    {isSavingContact ? "Saving..." : "Continue to shipping"}
                  </Button>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="shipping" className="border-none">
                <AccordionTrigger
                  className="rounded-2xl border border-border/60 px-4 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canOpenShipping}
                >
                  <StepLabel label="Shipping" complete={shippingComplete} />
                </AccordionTrigger>
                <AccordionContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="shipping-first-name">First name</Label>
                      <Input
                        id="shipping-first-name"
                        autoComplete="given-name"
                        value={shippingAddress.first_name}
                        onChange={(event) =>
                          setShippingAddress((prev) => ({ ...prev, first_name: event.target.value }))
                        }
                        aria-invalid={Boolean(addressErrors.first_name)}
                      />
                      {addressErrors.first_name ? (
                        <p className="text-xs text-destructive">{addressErrors.first_name}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-last-name">Last name</Label>
                      <Input
                        id="shipping-last-name"
                        autoComplete="family-name"
                        value={shippingAddress.last_name}
                        onChange={(event) =>
                          setShippingAddress((prev) => ({ ...prev, last_name: event.target.value }))
                        }
                        aria-invalid={Boolean(addressErrors.last_name)}
                      />
                      {addressErrors.last_name ? (
                        <p className="text-xs text-destructive">{addressErrors.last_name}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shipping-address">Address</Label>
                    <Input
                      id="shipping-address"
                      autoComplete="shipping address-line1"
                      value={shippingAddress.address_1}
                      onChange={(event) =>
                        setShippingAddress((prev) => ({ ...prev, address_1: event.target.value }))
                      }
                      aria-invalid={Boolean(addressErrors.address_1)}
                    />
                    {addressErrors.address_1 ? (
                      <p className="text-xs text-destructive">{addressErrors.address_1}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shipping-address-2">Apartment, suite, etc.</Label>
                    <Input
                      id="shipping-address-2"
                      autoComplete="shipping address-line2"
                      value={shippingAddress.address_2}
                      onChange={(event) =>
                        setShippingAddress((prev) => ({ ...prev, address_2: event.target.value }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="shipping-city">City</Label>
                      <Input
                        id="shipping-city"
                        autoComplete="shipping address-level2"
                        value={shippingAddress.city}
                        onChange={(event) =>
                          setShippingAddress((prev) => ({ ...prev, city: event.target.value }))
                        }
                        aria-invalid={Boolean(addressErrors.city)}
                      />
                      {addressErrors.city ? (
                        <p className="text-xs text-destructive">{addressErrors.city}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-province">State / Province</Label>
                      <Input
                        id="shipping-province"
                        autoComplete="shipping address-level1"
                        value={shippingAddress.province}
                        onChange={(event) =>
                          setShippingAddress((prev) => ({ ...prev, province: event.target.value }))
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="shipping-postal">Postal code</Label>
                      <Input
                        id="shipping-postal"
                        autoComplete="shipping postal-code"
                        value={shippingAddress.postal_code}
                        onChange={(event) =>
                          setShippingAddress((prev) => ({ ...prev, postal_code: event.target.value }))
                        }
                        aria-invalid={Boolean(addressErrors.postal_code)}
                      />
                      {addressErrors.postal_code ? (
                        <p className="text-xs text-destructive">{addressErrors.postal_code}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipping-country">Country</Label>
                      <Select
                        value={shippingAddress.country_code}
                        onValueChange={(value) =>
                          setShippingAddress((prev) => ({ ...prev, country_code: value }))
                        }
                      >
                        <SelectTrigger id="shipping-country" aria-invalid={Boolean(addressErrors.country_code)}>
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
                      {addressErrors.country_code ? (
                        <p className="text-xs text-destructive">{addressErrors.country_code}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shipping-phone">Phone</Label>
                    <Input
                      id="shipping-phone"
                      type="tel"
                      autoComplete="shipping tel"
                      value={shippingAddress.phone}
                      onChange={(event) =>
                        setShippingAddress((prev) => ({ ...prev, phone: event.target.value }))
                      }
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="billing-same"
                      checked={billingSame}
                      onCheckedChange={(value) => setBillingSame(Boolean(value))}
                    />
                    <Label htmlFor="billing-same" className="text-xs uppercase tracking-[0.3rem]">
                      Billing address is the same
                    </Label>
                  </div>

                  {!billingSame ? (
                    <div className="space-y-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                      <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                        Billing address
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="billing-first-name">First name</Label>
                          <Input
                            id="billing-first-name"
                            autoComplete="billing given-name"
                            value={billingAddress.first_name}
                            onChange={(event) =>
                              setBillingAddress((prev) => ({ ...prev, first_name: event.target.value }))
                            }
                            aria-invalid={Boolean(billingErrors.first_name)}
                          />
                          {billingErrors.first_name ? (
                            <p className="text-xs text-destructive">{billingErrors.first_name}</p>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billing-last-name">Last name</Label>
                          <Input
                            id="billing-last-name"
                            autoComplete="billing family-name"
                            value={billingAddress.last_name}
                            onChange={(event) =>
                              setBillingAddress((prev) => ({ ...prev, last_name: event.target.value }))
                            }
                            aria-invalid={Boolean(billingErrors.last_name)}
                          />
                          {billingErrors.last_name ? (
                            <p className="text-xs text-destructive">{billingErrors.last_name}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-address">Address</Label>
                        <Input
                          id="billing-address"
                          autoComplete="billing address-line1"
                          value={billingAddress.address_1}
                          onChange={(event) =>
                            setBillingAddress((prev) => ({ ...prev, address_1: event.target.value }))
                          }
                          aria-invalid={Boolean(billingErrors.address_1)}
                        />
                        {billingErrors.address_1 ? (
                          <p className="text-xs text-destructive">{billingErrors.address_1}</p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-city">City</Label>
                        <Input
                          id="billing-city"
                          autoComplete="billing address-level2"
                          value={billingAddress.city}
                          onChange={(event) =>
                            setBillingAddress((prev) => ({ ...prev, city: event.target.value }))
                          }
                          aria-invalid={Boolean(billingErrors.city)}
                        />
                        {billingErrors.city ? (
                          <p className="text-xs text-destructive">{billingErrors.city}</p>
                        ) : null}
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="billing-postal">Postal code</Label>
                          <Input
                            id="billing-postal"
                            autoComplete="billing postal-code"
                            value={billingAddress.postal_code}
                            onChange={(event) =>
                              setBillingAddress((prev) => ({ ...prev, postal_code: event.target.value }))
                            }
                            aria-invalid={Boolean(billingErrors.postal_code)}
                          />
                          {billingErrors.postal_code ? (
                            <p className="text-xs text-destructive">{billingErrors.postal_code}</p>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="billing-country">Country</Label>
                          <Select
                            value={billingAddress.country_code}
                            onValueChange={(value) =>
                              setBillingAddress((prev) => ({ ...prev, country_code: value }))
                            }
                          >
                            <SelectTrigger id="billing-country" aria-invalid={Boolean(billingErrors.country_code)}>
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
                          {billingErrors.country_code ? (
                            <p className="text-xs text-destructive">{billingErrors.country_code}</p>
                          ) : null}
                        </div>
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
                    {standardShippingOption ? (
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

                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleAddressSubmit()}
                    disabled={isSavingAddress}
                  >
                    {isSavingAddress ? "Saving..." : "Continue to payment"}
                  </Button>
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
                    <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                      <p>Taxes are calculated after your shipping method is selected.</p>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void runTaxCalculation()}
                        disabled={isCalculatingTaxes || !currentTaxKey}
                      >
                        {isCalculatingTaxes ? "Calculating taxes..." : "Calculate taxes"}
                      </Button>
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
