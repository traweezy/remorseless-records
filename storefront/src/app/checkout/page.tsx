"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Lock, ShoppingBag } from "lucide-react"
import type { Stripe, StripeCardElement, StripeElements } from "@stripe/stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import type { HttpTypes } from "@medusajs/types"
import Image from "next/image"
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
  card: StripeCardElement | null
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

const normalizeSignatureValue = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase()

const createTabId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const hasAddressValues = (address: AddressSnapshotSource | null | undefined): boolean =>
  Boolean(
    normalizeSignatureValue(address?.first_name) ||
      normalizeSignatureValue(address?.last_name) ||
      normalizeSignatureValue(address?.address_1) ||
      normalizeSignatureValue(address?.address_2) ||
      normalizeSignatureValue(address?.city) ||
      normalizeSignatureValue(address?.province) ||
      normalizeSignatureValue(address?.postal_code) ||
      normalizeSignatureValue(address?.country_code) ||
      normalizeSignatureValue(address?.phone)
  )

type AddressSnapshotSource = {
  first_name?: string | null | undefined
  last_name?: string | null | undefined
  address_1?: string | null | undefined
  address_2?: string | null | undefined
  city?: string | null | undefined
  province?: string | null | undefined
  postal_code?: string | null | undefined
  country_code?: string | null | undefined
  phone?: string | null | undefined
}

const buildAddressSnapshot = (address: AddressSnapshotSource | null | undefined): string =>
  [
    normalizeSignatureValue(address?.first_name),
    normalizeSignatureValue(address?.last_name),
    normalizeSignatureValue(address?.address_1),
    normalizeSignatureValue(address?.address_2),
    normalizeSignatureValue(address?.city),
    normalizeSignatureValue(address?.province),
    normalizeSignatureValue(address?.postal_code),
    normalizeSignatureValue(address?.country_code),
    normalizeSignatureValue(address?.phone),
  ].join("::")

const buildItemsSignature = (items: HttpTypes.StoreCartLineItem[] | null | undefined): string => {
  if (!items?.length) {
    return ""
  }

  return items
    .map((item) => `${item.variant_id ?? item.id}:${Number(item.quantity ?? 0)}`)
    .sort()
    .join("|")
}

const buildShippingSignature = (
  cart: HttpTypes.StoreCart | null,
  shippingOptionId: string | null
): string | null => {
  if (!cart) {
    return null
  }

  const address = cart.shipping_address
  return [
    cart.id,
    normalizeSignatureValue(address?.first_name),
    normalizeSignatureValue(address?.last_name),
    normalizeSignatureValue(address?.address_1),
    normalizeSignatureValue(address?.address_2),
    normalizeSignatureValue(address?.city),
    normalizeSignatureValue(address?.province),
    normalizeSignatureValue(address?.postal_code),
    normalizeSignatureValue(address?.country_code),
    normalizeSignatureValue(address?.phone),
    normalizeSignatureValue(shippingOptionId),
  ].join("::")
}

const buildPaymentSignature = (
  cart: HttpTypes.StoreCart | null,
  shippingOptionId: string | null
): string | null => {
  if (!cart) {
    return null
  }

  return [
    buildShippingSignature(cart, shippingOptionId) ?? "",
    normalizeSignatureValue(cart.email),
  ].join("::")
}

const StripeCardElement = ({ onReady }: { onReady: (state: StripeState) => void }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    let element: StripeCardElement | null = null

    const mount = async () => {
      if (!containerRef.current) return

      const stripe = await stripePromise
      if (!stripe) {
        return
      }

      if (!mounted || !containerRef.current) {
        return
      }

      const readThemeColor = (name: string, fallback: string) => {
        const value = getComputedStyle(document.documentElement)
          .getPropertyValue(name)
          .trim()
        if (!value) return fallback
        if (!document.body) return fallback

        const sample = document.createElement("div")
        const token = value.startsWith("#") || value.startsWith("rgb") || value.startsWith("hsl")
          ? value
          : `hsl(${value})`
        sample.style.color = token
        document.body.appendChild(sample)
        const computed = getComputedStyle(sample).color
        document.body.removeChild(sample)
        return computed || fallback
      }

      const theme = {
        foreground: readThemeColor("--foreground", "#f1f1f1"),
        muted: readThemeColor("--muted-foreground", "#b5b5b5"),
        background: readThemeColor("--background", "#0f0f0f"),
        card: readThemeColor("--card", "#151515"),
        border: readThemeColor("--border", "#2c2c2c"),
        accent: readThemeColor("--accent", "#d11c1c"),
        destructive: readThemeColor("--destructive", "#ff4d4d"),
      }

      const toRgba = (color: string, alpha: number, fallback: string) => {
        if (color.startsWith("rgba(")) return color
        if (color.startsWith("rgb(")) {
          return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`)
        }
        if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
          const hex = color.length === 4
            ? color
                .slice(1)
                .split("")
                .map((ch) => ch + ch)
                .join("")
            : color.slice(1)
          const r = parseInt(hex.slice(0, 2), 16)
          const g = parseInt(hex.slice(2, 4), 16)
          const b = parseInt(hex.slice(4, 6), 16)
          return `rgba(${r}, ${g}, ${b}, ${alpha})`
        }
        return fallback
      }

      const accentGlow = toRgba(theme.accent, 0.35, "rgba(209, 28, 28, 0.35)")

      const elements = stripe.elements({
        appearance: {
          theme: "flat",
          variables: {
            colorText: theme.foreground,
            colorDanger: theme.destructive,
            colorTextSecondary: theme.muted,
            colorBackground: theme.background,
            fontFamily: "var(--font-sans)",
            fontSizeBase: "15px",
            spacingUnit: "4px",
          },
          rules: {
            ".Input": {
              backgroundColor: theme.card,
              border: `1px solid ${theme.border}`,
              borderRadius: "16px",
              padding: "12px 14px",
            },
            ".Input::placeholder": {
              color: theme.muted,
            },
            ".Input:focus": {
              borderColor: theme.accent,
              boxShadow: `0 0 0 2px ${accentGlow}`,
            },
            ".Label": {
              color: theme.muted,
              fontSize: "12px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            },
          },
        },
      })

      element = elements.create("card", {
        hidePostalCode: true,
        style: {
          base: {
            color: theme.foreground,
            fontFamily: "var(--font-sans)",
            fontSize: "15px",
            iconColor: theme.accent,
            "::placeholder": {
              color: theme.muted,
            },
          },
          invalid: {
            color: theme.destructive,
          },
        },
      })
      if (!mounted || !containerRef.current) {
        element.destroy()
        return
      }

      element.mount(containerRef.current)

      if (mounted) {
        onReady({ stripe, elements, card: element })
      }
    }

    void mount()

    return () => {
      mounted = false
      element?.destroy()
    }
  }, [onReady])

  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
          Card details
        </p>
        <span className="text-[10px] uppercase tracking-[0.2rem] text-muted-foreground">
          Secure via Stripe
        </span>
      </div>
      <div ref={containerRef} className="mt-3 min-h-[54px]" />
    </div>
  )
}

const CheckoutPage = () => {
  const router = useRouter()
  const {
    cart,
    isLoading,
    itemCount,
    subtotal,
    taxTotal,
    shippingSubtotal,
    discountTotal,
    total,
    setEmail,
    setAddresses,
    listShippingOptions,
    addShippingMethod,
    calculateTaxes,
    initPaymentSessions,
    completeCart,
    refreshCart,
  } = useCart()

  const [activeStep, setActiveStep] = useState("contact")
  const [contactComplete, setContactComplete] = useState(false)
  const [shippingSubmitted, setShippingSubmitted] = useState(false)
  const [isSavingContact, setIsSavingContact] = useState(false)
  const [isSavingAddress, setIsSavingAddress] = useState(false)
  const [isUpdatingShipping, setIsUpdatingShipping] = useState(false)
  const [shippingError, setShippingError] = useState<string | null>(null)
  const [isCalculatingTaxes, setIsCalculatingTaxes] = useState(false)
  const [taxError, setTaxError] = useState<string | null>(null)
  const [hasCalculatedTaxes, setHasCalculatedTaxes] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripeState, setStripeState] = useState<StripeState>({ stripe: null, elements: null, card: null })
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const [hasReachedPayment, setHasReachedPayment] = useState(false)
  const [savedShippingSignature, setSavedShippingSignature] = useState<string | null>(null)
  const [savedShippingSnapshot, setSavedShippingSnapshot] = useState<string | null>(null)
  const [hasSyncedShipping, setHasSyncedShipping] = useState(false)
  const [savedItemsSignature, setSavedItemsSignature] = useState<string | null>(null)
  const [savedTotalsSignature, setSavedTotalsSignature] = useState<string | null>(null)
  const [savedEmail, setSavedEmail] = useState<string | null>(null)
  const [cartNotice, setCartNotice] = useState<string | null>(null)
  const checkoutTabIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const key = "rr.checkout.tab"
    let tabId = window.sessionStorage.getItem(key)
    if (!tabId) {
      tabId = createTabId()
      window.sessionStorage.setItem(key, tabId)
    }
    checkoutTabIdRef.current = tabId
  }, [])

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
        setSavedEmail(updated.email)
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
      const updated = await applyShippingAndTaxes({
        addresses: {
          shipping_address: normalizeAddress(value.shipping),
          billing_address: value.billingSame
            ? normalizeAddress(value.shipping)
            : normalizeAddress(value.billing),
        },
      })

      if (updated?.shipping_address) {
        setHasReachedPayment(true)
      }
    },
  })

  const billingSame = shippingForm.state.values.billingSame

  const cartShippingHasValues = useMemo(
    () => hasAddressValues(cart?.shipping_address),
    [cart?.shipping_address]
  )
  const formShippingSnapshot = useMemo(
    () => buildAddressSnapshot(shippingForm.state.values.shipping),
    [shippingForm.state.values.shipping]
  )
  const shippingFormDirty =
    shippingSubmitted && Boolean(savedShippingSnapshot) && formShippingSnapshot !== savedShippingSnapshot
  const shippingComplete = contactComplete && shippingSubmitted && hasCalculatedTaxes
  const shippingStepComplete = shippingComplete && !shippingFormDirty && hasSyncedShipping
  const canOpenShipping = contactComplete
  const canOpenPayment = shippingComplete && hasSyncedShipping && !shippingFormDirty && !shippingError
  const computedShippingSubtotal = useMemo(() => {
    const count = Math.max(0, Math.trunc(itemCount))
    if (count === 0) return 0
    return 500 + Math.max(0, count - 1) * 50
  }, [itemCount])
  const resolvedShippingSubtotal =
    shippingSubtotal && shippingSubtotal > 0 ? shippingSubtotal : computedShippingSubtotal
  const resolvedShippingOptionId = cart?.shipping_methods?.[0]?.shipping_option_id ?? null
  const itemsSignature = useMemo(
    () => buildItemsSignature(cart?.items),
    [cart?.items]
  )
  const totalsSignature = useMemo(() => {
    if (!cart) return null
    return [
      String(cart.subtotal ?? 0),
      String(cart.discount_total ?? 0),
      String(cart.shipping_subtotal ?? 0),
      String(cart.tax_total ?? 0),
      String(cart.total ?? 0),
    ].join(":")
  }, [cart])
  const shippingSignature = useMemo(
    () => buildShippingSignature(cart ?? null, resolvedShippingOptionId),
    [cart, resolvedShippingOptionId]
  )
  const paymentSignature = useMemo(
    () => buildPaymentSignature(cart ?? null, resolvedShippingOptionId),
    [cart, resolvedShippingOptionId]
  )

  const handleStepChange = useCallback(
    (value: string) => {
      if (!value) return
      if (value === "shipping" && !canOpenShipping) return
      if (value === "payment" && !canOpenPayment) return
      setActiveStep(value)
      if (value === "payment") {
        setHasReachedPayment(true)
      }
    },
    [canOpenPayment, canOpenShipping]
  )

  const resetPaymentState = useCallback(() => {
    setClientSecret(null)
  }, [])

  const applyShippingAndTaxes = useCallback(
    async (options?: {
      addresses?: {
        shipping_address: StoreCartAddressInput
        billing_address?: StoreCartAddressInput
      }
      notice?: string
    }) => {
      const cartId = cart?.id
      if (!cartId) {
        return null
      }

      if (isUpdatingShipping || isCalculatingTaxes) {
        return null
      }

      setIsUpdatingShipping(true)
      setTaxError(null)
      setShippingError(null)
      if (options?.notice) {
        setCartNotice(options.notice)
      }

      try {
        let updated: HttpTypes.StoreCart | null = cart

        if (options?.addresses) {
          setIsSavingAddress(true)
          updated = await setAddresses(options.addresses)
          setIsSavingAddress(false)
        }

        const targetCartId = updated?.id ?? cartId
        const existingOptionId =
          updated?.shipping_methods?.[0]?.shipping_option_id ?? null
        let optionId = existingOptionId

        if (options?.addresses || !existingOptionId) {
          const shippingOptions = await listShippingOptions(targetCartId)

          if (shippingOptions.length !== 1) {
            setShippingError("Shipping is temporarily unavailable. Please try again.")
            return null
          }

          optionId = shippingOptions[0]?.id ?? null
          if (!optionId) {
            setShippingError("Shipping is temporarily unavailable. Please try again.")
            return null
          }

          updated = await addShippingMethod(optionId)
        }

        if (!optionId) {
          setShippingError("Shipping is temporarily unavailable. Please try again.")
          return null
        }

        setIsCalculatingTaxes(true)
        updated = await calculateTaxes()
        setIsCalculatingTaxes(false)

        if (!updated?.id) {
          setTaxError("Unable to calculate taxes. Please try again.")
          setHasCalculatedTaxes(false)
          return null
        }

        setHasCalculatedTaxes(true)
        setShippingSubmitted(true)
        setSavedShippingSignature(buildShippingSignature(updated, optionId) ?? null)
        setSavedShippingSnapshot(buildAddressSnapshot(updated.shipping_address))
        setHasSyncedShipping(false)
        setSavedItemsSignature(buildItemsSignature(updated.items))
        setSavedTotalsSignature(
          [
            String(updated.subtotal ?? 0),
            String(updated.discount_total ?? 0),
            String(updated.shipping_subtotal ?? 0),
            String(updated.tax_total ?? 0),
            String(updated.total ?? 0),
          ].join(":")
        )
        setCartNotice(null)
        return updated
      } catch (error) {
        console.error("Failed to update shipping or taxes", error)
        setShippingError("Unable to update shipping. Please try again.")
        setHasCalculatedTaxes(false)
        return null
      } finally {
        setIsSavingAddress(false)
        setIsCalculatingTaxes(false)
        setIsUpdatingShipping(false)
      }
    },
    [
      addShippingMethod,
      calculateTaxes,
      cart,
      isCalculatingTaxes,
      isUpdatingShipping,
      listShippingOptions,
      setAddresses,
    ]
  )

  const invalidateContact = useCallback(() => {
    if (contactComplete) {
      setContactComplete(false)
    }
    if (savedEmail) {
      setSavedEmail(null)
    }
    setHasReachedPayment(false)
    resetPaymentState()
    setCartNotice(null)
  }, [contactComplete, resetPaymentState, savedEmail])

  const invalidateShipping = useCallback(() => {
    if (!shippingSubmitted) return
    setShippingSubmitted(false)
    setTaxError(null)
    setShippingError(null)
    setHasCalculatedTaxes(false)
    setHasReachedPayment(false)
    resetPaymentState()
    setSavedShippingSignature(null)
    setSavedShippingSnapshot(null)
    setHasSyncedShipping(false)
    setSavedItemsSignature(null)
    setSavedTotalsSignature(null)
    setCartNotice(null)
  }, [resetPaymentState, shippingSubmitted])

  useEffect(() => {
    if (!isLoading && (!cart || !cart.items?.length)) {
      router.replace("/catalog")
    }
  }, [cart, isLoading, router])

  useEffect(() => {
    resetPaymentState()
  }, [cart?.id, cart?.shipping_methods, cart?.total, resetPaymentState])

  useEffect(() => {
    if (activeStep === "payment") {
      setHasReachedPayment(true)
    }
  }, [activeStep])

  useEffect(() => {
    if (!savedShippingSignature || !shippingSignature || hasSyncedShipping) {
      return
    }
    if (cartShippingHasValues && resolvedShippingOptionId && shippingSignature === savedShippingSignature) {
      setHasSyncedShipping(true)
    }
  }, [
    cartShippingHasValues,
    hasSyncedShipping,
    resolvedShippingOptionId,
    savedShippingSignature,
    shippingSignature,
  ])

  useEffect(() => {
    if (!shippingSubmitted) {
      return
    }

    const shippingChanged =
      hasSyncedShipping &&
      Boolean(savedShippingSignature) &&
      Boolean(shippingSignature) &&
      shippingSignature !== savedShippingSignature
    const itemsChanged =
      Boolean(savedItemsSignature) &&
      Boolean(itemsSignature) &&
      itemsSignature !== savedItemsSignature
    const totalsChanged =
      Boolean(savedTotalsSignature) &&
      Boolean(totalsSignature) &&
      totalsSignature !== savedTotalsSignature

    if (shippingChanged) {
      setCartNotice("Your cart or shipping info changed. Please confirm shipping again.")
      invalidateShipping()
      if (activeStep === "payment") {
        setActiveStep("shipping")
      }
      return
    }

    if ((itemsChanged || totalsChanged) && !isUpdatingShipping && !isCalculatingTaxes) {
      const notice = itemsChanged
        ? "Cart updated. Recalculating shipping and taxes."
        : "Totals updated. Recalculating shipping and taxes."
      setCartNotice(notice)
      resetPaymentState()
      setHasReachedPayment(false)
      if (activeStep === "payment") {
        setActiveStep("shipping")
      }
      void applyShippingAndTaxes({ notice })
    }
  }, [
    activeStep,
    applyShippingAndTaxes,
    invalidateShipping,
    isCalculatingTaxes,
    isUpdatingShipping,
    itemsSignature,
    resetPaymentState,
    savedItemsSignature,
    savedShippingSignature,
    savedTotalsSignature,
    hasSyncedShipping,
    shippingSignature,
    shippingSubmitted,
    totalsSignature,
  ])

  useEffect(() => {
    if (!contactComplete) {
      return
    }
    const currentEmail = normalizeSignatureValue(cart?.email)
    if (savedEmail && currentEmail !== normalizeSignatureValue(savedEmail)) {
      setContactComplete(false)
      setSavedEmail(null)
      setActiveStep("contact")
    }
  }, [cart?.email, contactComplete, savedEmail])

  useEffect(() => {
    if (!cart?.id || !paymentSignature) return
    if (activeStep !== "payment") return
    if (!shippingComplete) return
    if (typeof window === "undefined") return

    const key = `rr.checkout.${cart.id}.payment`
    const currentTabId = checkoutTabIdRef.current ?? createTabId()
    checkoutTabIdRef.current = currentTabId

    let storedSignature: string | null = null
    let storedTabId: string | null = null
    const rawStored = window.localStorage.getItem(key)
    if (rawStored) {
      try {
        const parsed = JSON.parse(rawStored) as { signature?: string; tabId?: string }
        storedSignature = typeof parsed.signature === "string" ? parsed.signature : null
        storedTabId = typeof parsed.tabId === "string" ? parsed.tabId : null
      } catch {
        storedSignature = null
        storedTabId = null
      }
    }

    if (
      storedSignature &&
      storedTabId &&
      storedTabId !== currentTabId &&
      storedSignature !== paymentSignature
    ) {
      setPaymentError("Cart changed in another tab. Review shipping details.")
      invalidateShipping()
      setActiveStep("shipping")
      return
    }

    window.localStorage.setItem(
      key,
      JSON.stringify({ signature: paymentSignature, tabId: currentTabId })
    )
  }, [activeStep, cart?.id, invalidateShipping, paymentSignature, shippingComplete])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleFocus = () => {
      void refreshCart({ silent: true })
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshCart({ silent: true })
      }
    }
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [refreshCart])

  useEffect(() => {
    if (!contactComplete && activeStep !== "contact") {
      setActiveStep("contact")
      return
    }
    if (
      contactComplete &&
      !canOpenPayment &&
      activeStep === "payment" &&
      !isSavingAddress &&
      !isUpdatingShipping &&
      !isCalculatingTaxes
    ) {
      setActiveStep("shipping")
    }
  }, [
    activeStep,
    canOpenPayment,
    contactComplete,
    isCalculatingTaxes,
    isSavingAddress,
    isUpdatingShipping,
  ])

  useEffect(() => {
    if (hasReachedPayment && canOpenPayment && activeStep !== "payment") {
      setActiveStep("payment")
    }
  }, [activeStep, canOpenPayment, hasReachedPayment])

  const countryOptions = useMemo(() => extractCountryOptions(cart ?? null), [cart])

  const summaryTotal = total ?? 0
  const currencyCode = cart?.currency_code ?? "usd"

  const resolveMoney = useCallback(
    (value: number | null, fallback: string) =>
      value === null || value === undefined ? fallback : formatAmount(currencyCode, value),
    [currencyCode]
  )

  const handlePlaceOrder = async () => {
    if (!cart?.id) return

    if (!hasCalculatedTaxes || shippingFormDirty || shippingError) {
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

    if (!stripeState.stripe || !stripeState.card) {
      setPaymentError("Payment form is still loading. Please wait.")
      setIsPlacingOrder(false)
      return
    }

    let resolvedClientSecret = clientSecret
    if (!resolvedClientSecret) {
      try {
        const session = await initPaymentSessions()
        resolvedClientSecret = session.clientSecret
        if (resolvedClientSecret) {
          setClientSecret(resolvedClientSecret)
          setPaymentError(null)
        }
      } catch (sessionError) {
        console.error("Failed to initialize payment session", sessionError)
        setPaymentError("Unable to initialize payment. Please try again.")
        setIsPlacingOrder(false)
        return
      }
    }

    if (!resolvedClientSecret) {
      setPaymentError("Unable to initialize payment. Please try again.")
      setIsPlacingOrder(false)
      return
    }

    const returnUrl = `${window.location.origin}/checkout/success?cart_id=${cart.id}`

    const billingSource = billingSame
      ? shippingForm.state.values.shipping
      : shippingForm.state.values.billing
    const emailValue = contactForm.state.values.email.trim()
    const phoneValue = billingSource.phone?.trim()
    const line2Value = billingSource.address_2?.trim()
    const stateValue = billingSource.province?.trim()
    const billingDetails = {
      name: `${billingSource.first_name} ${billingSource.last_name}`.trim(),
      email: emailValue.length ? emailValue : cart.email ?? null,
      phone: phoneValue && phoneValue.length ? phoneValue : null,
      address: {
        line1: billingSource.address_1,
        line2: line2Value && line2Value.length ? line2Value : null,
        city: billingSource.city,
        state: stateValue && stateValue.length ? stateValue : null,
        postal_code: billingSource.postal_code,
        country: billingSource.country_code,
      },
    }

    const result = await stripeState.stripe.confirmCardPayment(resolvedClientSecret, {
      payment_method: {
        card: stripeState.card,
        billing_details: billingDetails,
      },
      return_url: returnUrl,
    })

    if (result.error) {
      const message = result.error.message ?? "Payment failed. Please try again."
      const code = result.error.code ?? ""
      const normalized = `${code} ${message}`.toLowerCase()

      if (
        normalized.includes("payment_intent") &&
        (normalized.includes("expired") ||
          normalized.includes("not found") ||
          normalized.includes("client_secret"))
      ) {
        resetPaymentState()
        setPaymentError("Payment expired. Please try again.")
      } else {
        setPaymentError(message)
      }

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
          href="/catalog"
          nativePrefetch
          className="inline-flex min-h-[44px] items-center rounded-full border border-accent px-6 text-xs font-semibold uppercase tracking-[0.3rem] text-accent"
        >
          Browse catalog
        </SmartLink>
      </div>
    )
  }

  const showSummaryCharges = hasReachedPayment && shippingComplete && !shippingFormDirty && !shippingError
  const shippingEstimate = showSummaryCharges
    ? resolveMoney(resolvedShippingSubtotal, formatAmount(currencyCode, 0))
    : "-"
  const taxEstimate = showSummaryCharges ? resolveMoney(taxTotal, formatAmount(currencyCode, 0)) : "-"

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
          href="/?cart=1"
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
                  <StepLabel label="Shipping" complete={shippingStepComplete} />
                </AccordionTrigger>
                <AccordionContent>
                  {cartNotice ? (
                    <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
                      {cartNotice}
                    </div>
                  ) : null}
                  {shippingFormDirty ? (
                    <div className="mb-4 rounded-lg border border-border/60 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                      Update your shipping details and save to continue.
                    </div>
                  ) : null}
                  {shippingError ? (
                    <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {shippingError}
                    </div>
                  ) : null}
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
                      </div>
                      <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm">
                        <span className="font-medium text-foreground">Standard Shipping</span>
                        <span className="text-muted-foreground">
                          {resolveMoney(resolvedShippingSubtotal, formatAmount(currencyCode, 0))}
                        </span>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isSavingAddress || isUpdatingShipping || isCalculatingTaxes}
                    >
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
                  ) : (
                    <StripeCardElement onReady={setStripeState} />
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
                      (Number(cart?.total ?? 0) > 0 && !stripeState.card)
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
                  <div className="flex items-start gap-3">
                    <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-muted">
                      {item.thumbnail ? (
                        <Image
                          src={item.thumbnail}
                          alt={item.title ?? "Order item"}
                          fill
                          sizes="48px"
                          className="object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{item.title}</p>
                      <p className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                        Qty {item.quantity}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {formatAmount(
                      currencyCode,
                      typeof item.subtotal === "number"
                        ? item.subtotal
                        : Number(item.unit_price ?? 0) * Number(item.quantity ?? 0)
                    )}
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
