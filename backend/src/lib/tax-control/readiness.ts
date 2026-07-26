import Stripe from "stripe";

import {
  STRIPE_API_KEY,
  STRIPE_TAX_SHIPPING_TAX_CODE,
  TAX_RATE_LOOKUP_API_KEY,
} from "../constants";

export type ReadinessCheck = {
  detail: string;
  id: string;
  label: string;
  ready: boolean;
};

export type ProviderReadiness = {
  checks: ReadinessCheck[];
  configured: boolean;
  message: string;
  ready: boolean;
};

export type StripeTaxReadiness = ProviderReadiness & {
  accountMode: "live" | "sandbox" | "unknown";
  activeRegistrationCount: number;
  missingFields: string[];
};

const check = (
  id: string,
  label: string,
  ready: boolean,
  detail: string,
): ReadinessCheck => ({ detail, id, label, ready });

export const resolveTaxRateIoReadiness = (
  remaining: number | null,
): ProviderReadiness => {
  const configured = Boolean(TAX_RATE_LOOKUP_API_KEY.trim());
  const quotaAvailable = remaining === null || remaining > 0;
  const checks = [
    check(
      "api_key",
      "API key",
      configured,
      configured
        ? "A TaxRate.io key is configured."
        : "Set TAX_RATE_LOOKUP_API_KEY.",
    ),
    check(
      "quota",
      "Lookup quota",
      quotaAvailable,
      remaining === null
        ? "No usage snapshot is available yet."
        : `${remaining} lookup${remaining === 1 ? "" : "s"} remain in the latest snapshot.`,
    ),
  ];

  return {
    checks,
    configured,
    message: !configured
      ? "TaxRate.io is not configured."
      : quotaAvailable
        ? "TaxRate.io can calculate US ZIP-code rates."
        : "TaxRate.io reports no remaining lookups.",
    ready: configured && quotaAvailable,
  };
};

export const resolveStripeTaxReadiness =
  async (): Promise<StripeTaxReadiness> => {
    const apiKey = STRIPE_API_KEY?.trim();
    if (!apiKey) {
      const checks = [
        check(
          "api_key",
          "Stripe key",
          false,
          "Set STRIPE_API_KEY for this environment.",
        ),
      ];
      return {
        accountMode: "unknown",
        activeRegistrationCount: 0,
        checks,
        configured: false,
        message: "Stripe is not configured.",
        missingFields: [],
        ready: false,
      };
    }

    try {
      const stripe = new Stripe(apiKey, { timeout: 8_000 });
      const [settings, registrations] = await Promise.all([
        stripe.tax.settings.retrieve(),
        stripe.tax.registrations.list({ limit: 100, status: "active" }),
      ]);
      const activeRegistrations = registrations.data.filter(
        (registration) =>
          registration.status === "active" &&
          registration.livemode === settings.livemode,
      );
      const missingFields =
        settings.status_details.pending?.missing_fields ?? [];
      const accountMode = settings.livemode ? "live" : "sandbox";
      const shippingTaxCodeReady = Boolean(
        STRIPE_TAX_SHIPPING_TAX_CODE &&
        /^txcd_\d{8}$/.test(STRIPE_TAX_SHIPPING_TAX_CODE),
      );
      const checks = [
        check(
          "api_key",
          "Stripe key",
          true,
          `Connected to the ${accountMode} account.`,
        ),
        check(
          "settings",
          "Tax settings",
          settings.status === "active",
          settings.status === "active"
            ? "Stripe Tax settings are active."
            : `Stripe still needs: ${missingFields.join(", ") || "Tax settings setup"}.`,
        ),
        check(
          "head_office",
          "Head office",
          Boolean(settings.head_office),
          settings.head_office
            ? "A tax head-office address is set."
            : "Set the legal head-office address in Stripe Tax settings.",
        ),
        check(
          "provider",
          "Calculation provider",
          settings.defaults.provider === "stripe",
          settings.defaults.provider === "stripe"
            ? "Stripe is the configured calculation provider."
            : `Stripe reports ${settings.defaults.provider} as the calculation provider.`,
        ),
        check(
          "tax_behavior",
          "Price tax behavior",
          settings.defaults.tax_behavior === "exclusive",
          settings.defaults.tax_behavior === "exclusive"
            ? "Prices are tax-exclusive, matching Medusa."
            : "Set Stripe's default tax behavior to exclusive.",
        ),
        check(
          "product_tax_code",
          "Default product tax code",
          Boolean(settings.defaults.tax_code),
          settings.defaults.tax_code
            ? `Stripe default: ${settings.defaults.tax_code}. Product metadata can override it.`
            : "Set a reviewed default product tax code in Stripe.",
        ),
        check(
          "shipping_tax_code",
          "Shipping tax code",
          shippingTaxCodeReady,
          shippingTaxCodeReady
            ? `Configured as ${STRIPE_TAX_SHIPPING_TAX_CODE}.`
            : "Set STRIPE_TAX_SHIPPING_TAX_CODE after reviewing the shipping classification.",
        ),
        check(
          "registration",
          "Active registration",
          activeRegistrations.length > 0,
          activeRegistrations.length
            ? `${activeRegistrations.length} active registration${activeRegistrations.length === 1 ? "" : "s"} found.`
            : `Add at least one active ${accountMode} registration.`,
        ),
      ];

      return {
        accountMode,
        activeRegistrationCount: activeRegistrations.length,
        checks,
        configured: true,
        message: checks.every((item) => item.ready)
          ? `Stripe Tax is ready in ${accountMode}.`
          : `Stripe Tax ${accountMode} setup is incomplete.`,
        missingFields,
        ready: checks.every((item) => item.ready),
      };
    } catch {
      const checks = [
        check(
          "api_connection",
          "Stripe connection",
          false,
          "Stripe Tax settings could not be read. Verify the key and try again.",
        ),
      ];
      return {
        accountMode: apiKey.startsWith("sk_live_")
          ? "live"
          : apiKey.startsWith("sk_test_")
            ? "sandbox"
            : "unknown",
        activeRegistrationCount: 0,
        checks,
        configured: true,
        message: "Stripe Tax readiness could not be verified.",
        missingFields: [],
        ready: false,
      };
    }
  };
