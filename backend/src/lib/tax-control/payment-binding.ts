import type Stripe from "stripe";
import { MathBN, MedusaError } from "@medusajs/framework/utils";

import { validateCheckoutPayment } from "../checkout/payment-validation";
import { taxQuoteIdentityFromCart } from "./quote";
import type TaxControlModuleService from "../../modules/tax-control/service";

type UnknownRecord = Record<string, unknown>;

const LINKABLE_PAYMENT_STATUSES = new Set([
  "requires_confirmation",
  "requires_payment_method",
]);

const PROCESSABLE_SESSION_STATUSES = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const minorUnits = (value: string): number => {
  const amount = Math.round(MathBN.mult(value, 100).toNumber());
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The payable tax-bound amount is invalid.",
    );
  }
  return amount;
};

const paymentSessionFrom = (cart: UnknownRecord): UnknownRecord => {
  const collection = asRecord(cart.payment_collection);
  const sessions = (
    Array.isArray(collection?.payment_sessions)
      ? collection.payment_sessions
      : []
  )
    .map(asRecord)
    .filter(
      (session): session is UnknownRecord =>
        session !== null &&
        text(session.provider_id) === "pp_stripe_stripe" &&
        PROCESSABLE_SESSION_STATUSES.has(text(session.status)),
    );
  if (sessions.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Exactly one pending Stripe payment session is required.",
    );
  }
  return sessions[0]!;
};

const assertIntentMetadata = (
  intent: Stripe.PaymentIntent,
  quote: ReturnType<typeof taxQuoteIdentityFromCart>,
  cartId: string,
): void => {
  const generation = Number(intent.metadata.rr_tax_generation);
  const rate = Number(intent.metadata.rr_tax_rate_percent);
  if (
    intent.metadata.medusa_cart_id !== cartId ||
    intent.metadata.rr_tax_provider !== quote.provider ||
    !Number.isSafeInteger(generation) ||
    generation !== quote.generation ||
    intent.metadata.rr_tax_fingerprint !== quote.fingerprint ||
    (intent.metadata.rr_tax_calculation_id ?? "") !==
      (quote.calculationId ?? "") ||
    (quote.provider === "taxrate_io" &&
      (!Number.isFinite(rate) || rate < 0 || rate !== quote.taxRatePercent))
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Stripe returned a PaymentIntent with a different tax identity.",
    );
  }
};

const existingHookCalculation = (intent: Stripe.PaymentIntent): string | null =>
  intent.hooks?.inputs?.tax?.calculation ?? null;

export type BindCheckoutTaxResult = {
  generation: number;
  provider: "stripe_tax" | "taxrate_io";
  replayed: boolean;
};

export const bindCheckoutTaxToPayment = async ({
  cart,
  client,
  service,
}: {
  cart: unknown;
  client: Stripe;
  service: TaxControlModuleService;
}): Promise<BindCheckoutTaxResult> => {
  const cartRecord = asRecord(cart);
  const cartId = text(cartRecord?.id);
  if (!cartRecord || !/^cart_[A-Za-z0-9]+$/.test(cartId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The tax binding cart is invalid.",
    );
  }

  const validation = validateCheckoutPayment(cartRecord);
  const amountMinor = minorUnits(validation.total);
  const quote = taxQuoteIdentityFromCart(cartRecord);
  const session = paymentSessionFrom(cartRecord);
  const sessionData = asRecord(session.data);
  const paymentIntentId = text(sessionData?.id);
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The Stripe PaymentIntent identity is unavailable.",
    );
  }

  const existingEvidence = (
    await service.listTaxQuoteEvidences(
      { payment_intent_id: paymentIntentId },
      { take: 1 },
    )
  )[0];
  if (quote.calculationId) {
    const calculationEvidence = (
      await service.listTaxQuoteEvidences(
        { calculation_id: quote.calculationId },
        { take: 1 },
      )
    )[0];
    if (
      calculationEvidence &&
      calculationEvidence.payment_intent_id !== paymentIntentId
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Stripe Tax calculation is already bound to another PaymentIntent.",
      );
    }
  }

  const intent = await client.paymentIntents.retrieve(paymentIntentId);
  if (
    intent.amount !== amountMinor ||
    intent.currency.toLowerCase() !== validation.currencyCode
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The Stripe PaymentIntent amount or currency does not match Medusa.",
    );
  }
  assertIntentMetadata(intent, quote, cartId);

  if (quote.provider === "stripe_tax") {
    const calculationId = quote.calculationId;
    if (!calculationId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Stripe Tax calculation identity is unavailable.",
      );
    }
    const calculation = await client.tax.calculations.retrieve(calculationId);
    if (
      calculation.amount_total !== amountMinor ||
      calculation.currency.toLowerCase() !== validation.currencyCode ||
      calculation.livemode !== intent.livemode ||
      !calculation.expires_at ||
      calculation.expires_at <= Math.floor(Date.now() / 1000)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Stripe Tax calculation does not match the payable Medusa cart.",
      );
    }

    const hookedCalculation = existingHookCalculation(intent);
    if (hookedCalculation && hookedCalculation !== calculationId) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The PaymentIntent is linked to a different Stripe Tax calculation.",
      );
    }
    if (!hookedCalculation && !LINKABLE_PAYMENT_STATUSES.has(intent.status)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The PaymentIntent can no longer be linked safely.",
      );
    }
    if (!hookedCalculation) {
      await client.paymentIntents.update(
        paymentIntentId,
        {
          hooks: {
            inputs: {
              tax: { calculation: calculationId },
            },
          },
          metadata: {
            medusa_cart_id: cartId,
            rr_tax_calculation_id: calculationId,
            rr_tax_fingerprint: quote.fingerprint,
            rr_tax_generation: String(quote.generation),
            rr_tax_provider: quote.provider,
          },
        },
        {
          idempotencyKey: `rr-tax-link-${paymentIntentId}-${quote.fingerprint}`,
        },
      );
    }
  }

  const recorded = await service.recordTaxQuoteEvidence({
    amountMinor,
    calculationId: quote.calculationId,
    cartId,
    currencyCode: validation.currencyCode,
    fingerprint: quote.fingerprint,
    generation: quote.generation,
    paymentIntentId,
    provider: quote.provider,
    status: intent.status === "succeeded" ? "succeeded" : "prepared",
  });

  return {
    generation: quote.generation,
    provider: quote.provider,
    replayed:
      Boolean(existingEvidence) ||
      recorded.replayed ||
      Boolean(existingHookCalculation(intent)),
  };
};
