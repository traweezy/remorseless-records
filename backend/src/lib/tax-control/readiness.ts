import type { Logger } from "@medusajs/framework/types"
import Stripe from "stripe"

import {
  STRIPE_API_KEY,
  STRIPE_TAX_SHIPPING_TAX_CODE,
  TAX_RATE_LOOKUP_API_KEY,
} from "../constants"
import {
  readStripeTaxReadiness,
  type StripeTaxReadinessClient,
  type StripeTaxReadinessRetryEvent,
} from "./stripe-readiness-client"

export type ReadinessCheck = {
  detail: string
  id: string
  label: string
  ready: boolean
}

export type ProviderReadiness = {
  checks: ReadinessCheck[]
  configured: boolean
  message: string
  ready: boolean
}

export type StripeTaxReadiness = ProviderReadiness & {
  accountMode: "live" | "sandbox" | "unknown"
  activeRegistrationCount: number
  missingFields: string[]
}

export type ResolveStripeTaxReadinessOptions = {
  apiKey?: string
  client?: StripeTaxReadinessClient
  logger?: Pick<Logger, "warn">
  timeoutMs?: number
}

const STRIPE_TAX_READINESS_TIMEOUT_MS = 8_000

const check = (
  id: string,
  label: string,
  ready: boolean,
  detail: string
): ReadinessCheck => ({ detail, id, label, ready })

export const resolveTaxRateIoReadiness = (
  remaining: number | null
): ProviderReadiness => {
  const configured = Boolean(TAX_RATE_LOOKUP_API_KEY.trim())
  const quotaAvailable = remaining === null || remaining > 0
  const checks = [
    check(
      "api_key",
      "API key",
      configured,
      configured
        ? "A TaxRate.io key is configured."
        : "Set TAX_RATE_LOOKUP_API_KEY."
    ),
    check(
      "quota",
      "Lookup quota",
      quotaAvailable,
      remaining === null
        ? "No usage snapshot is available yet."
        : `${remaining} lookup${remaining === 1 ? "" : "s"} remain in the latest snapshot.`
    ),
  ]

  return {
    checks,
    configured,
    message: !configured
      ? "TaxRate.io is not configured."
      : quotaAvailable
        ? "TaxRate.io can calculate US ZIP-code rates."
        : "TaxRate.io reports no remaining lookups.",
    ready: configured && quotaAvailable,
  }
}

const retryMessage = (event: StripeTaxReadinessRetryEvent): string =>
  `[tax-control] Stripe Tax ${event.operation} readiness retry scheduled (${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`

const accountModeFromApiKey = (
  apiKey: string
): StripeTaxReadiness["accountMode"] =>
  /^(?:rk|sk)_live_/.test(apiKey)
    ? "live"
    : /^(?:rk|sk)_test_/.test(apiKey)
      ? "sandbox"
      : "unknown"

export const resolveStripeTaxReadiness = async ({
  apiKey: configuredApiKey = STRIPE_API_KEY,
  client,
  logger,
  timeoutMs = STRIPE_TAX_READINESS_TIMEOUT_MS,
}: ResolveStripeTaxReadinessOptions = {}): Promise<StripeTaxReadiness> => {
  const apiKey = configuredApiKey?.trim()
  if (!apiKey) {
    const checks = [
      check(
        "api_key",
        "Stripe key",
        false,
        "Set STRIPE_API_KEY for this environment."
      ),
    ]
    return {
      accountMode: "unknown",
      activeRegistrationCount: 0,
      checks,
      configured: false,
      message: "Stripe is not configured.",
      missingFields: [],
      ready: false,
    }
  }

  try {
    const stripe =
      client ??
      new Stripe(apiKey, {
        httpClient: Stripe.createFetchHttpClient(),
        maxNetworkRetries: 0,
      })
    const snapshot = await readStripeTaxReadiness({
      client: stripe,
      ...(logger
        ? {
            onRetry: (event: StripeTaxReadinessRetryEvent) => {
              logger.warn(retryMessage(event))
            },
          }
        : {}),
      timeoutMs,
    })
    const accountMode = snapshot.livemode ? "live" : "sandbox"
    const configuredAccountMode = accountModeFromApiKey(apiKey)
    const shippingTaxCodeReady = Boolean(
      STRIPE_TAX_SHIPPING_TAX_CODE &&
      /^txcd_\d{8}$/.test(STRIPE_TAX_SHIPPING_TAX_CODE)
    )
    const checks = [
      check(
        "api_key",
        "Stripe key and mode",
        configuredAccountMode === accountMode,
        configuredAccountMode === accountMode
          ? `Connected to the ${accountMode} account.`
          : "The configured Stripe key prefix does not match the account mode."
      ),
      check(
        "settings",
        "Tax settings",
        snapshot.status === "active",
        snapshot.status === "active"
          ? "Stripe Tax settings are active."
          : `Stripe still needs: ${snapshot.missingFields.join(", ") || "Tax settings setup"}.`
      ),
      check(
        "head_office",
        "Head office",
        snapshot.hasHeadOffice,
        snapshot.hasHeadOffice
          ? "A tax head-office address is set."
          : "Set the legal head-office address in Stripe Tax settings."
      ),
      check(
        "provider",
        "Calculation provider",
        snapshot.provider === "stripe",
        snapshot.provider === "stripe"
          ? "Stripe is the configured calculation provider."
          : `Stripe reports ${snapshot.provider} as the calculation provider.`
      ),
      check(
        "tax_behavior",
        "Price tax behavior",
        snapshot.taxBehavior === "exclusive",
        snapshot.taxBehavior === "exclusive"
          ? "Prices are tax-exclusive, matching Medusa."
          : "Set Stripe's default tax behavior to exclusive."
      ),
      check(
        "product_tax_code",
        "Default product tax code",
        Boolean(snapshot.taxCode),
        snapshot.taxCode
          ? `Stripe default: ${snapshot.taxCode}. Product metadata can override it.`
          : "Set a reviewed default product tax code in Stripe."
      ),
      check(
        "shipping_tax_code",
        "Shipping tax code",
        shippingTaxCodeReady,
        shippingTaxCodeReady
          ? `Configured as ${STRIPE_TAX_SHIPPING_TAX_CODE}.`
          : "Set STRIPE_TAX_SHIPPING_TAX_CODE after reviewing the shipping classification."
      ),
      check(
        "registration",
        "Active registration",
        snapshot.activeRegistrationCount > 0,
        snapshot.activeRegistrationCount
          ? `${snapshot.activeRegistrationCount} active registration${snapshot.activeRegistrationCount === 1 ? "" : "s"} found.`
          : `Add at least one active ${accountMode} registration.`
      ),
    ]

    return {
      accountMode,
      activeRegistrationCount: snapshot.activeRegistrationCount,
      checks,
      configured: true,
      message: checks.every((item) => item.ready)
        ? `Stripe Tax is ready in ${accountMode}.`
        : `Stripe Tax ${accountMode} setup is incomplete.`,
      missingFields: snapshot.missingFields,
      ready: checks.every((item) => item.ready),
    }
  } catch {
    const checks = [
      check(
        "api_connection",
        "Stripe connection",
        false,
        "Stripe Tax settings could not be read. Verify the key and try again."
      ),
    ]
    return {
      accountMode: accountModeFromApiKey(apiKey),
      activeRegistrationCount: 0,
      checks,
      configured: true,
      message: "Stripe Tax readiness could not be verified.",
      missingFields: [],
      ready: false,
    }
  }
}
