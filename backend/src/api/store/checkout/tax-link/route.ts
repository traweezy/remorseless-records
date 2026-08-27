import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";
import type { ILockingModule } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";
import { z } from "zod";
import Stripe from "stripe";

import { verifyCheckoutTaxLinkProof } from "../../../../lib/checkout/internal-status-auth";
import { bindCheckoutTaxToPayment } from "../../../../lib/tax-control/payment-binding";
import { STRIPE_API_KEY } from "../../../../lib/constants";
import { taxBindingLockKey } from "../../../../modules/tax-control/constants";
import type TaxControlModuleService from "../../../../modules/tax-control/service";

type UnknownRecord = Record<string, unknown>;

type QueryGraph = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
    pagination?: { take?: number };
  }) => Promise<{ data: UnknownRecord[] }>;
};

const bodySchema = z
  .object({
    cart_id: z.string().regex(/^cart_[A-Za-z0-9]+$/),
  })
  .strict();

const TIMESTAMP_HEADER = "x-rr-checkout-timestamp";
const PROOF_HEADER = "x-rr-checkout-proof";

const header = (req: MedusaStoreRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === "string" ? value.trim() : undefined;
};

export const POST = async (
  req: MedusaStoreRequest,
  res: MedusaResponse,
): Promise<void> => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The checkout tax-link request is invalid.",
    );
  }

  const secret = process.env.CHECKOUT_BFF_SECRET?.trim();
  const timestampValue = header(req, TIMESTAMP_HEADER);
  const proof = header(req, PROOF_HEADER);
  const timestamp = timestampValue ? Number(timestampValue) : Number.NaN;
  if (
    !secret ||
    secret.length < 32 ||
    !proof ||
    !verifyCheckoutTaxLinkProof({
      cartId: parsed.data.cart_id,
      timestamp,
      secret,
      previousSecret: process.env.CHECKOUT_BFF_SECRET_PREVIOUS,
      proof,
    })
  ) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "The checkout tax-link proof is missing or invalid.",
    );
  }
  if (!STRIPE_API_KEY) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Stripe payment binding is not configured.",
    );
  }

  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY);
  const service = req.scope.resolve<TaxControlModuleService>("tax_control");
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING);
  const client = new Stripe(STRIPE_API_KEY, { timeout: 8_000 });
  const result = await locking.execute(
    taxBindingLockKey(parsed.data.cart_id),
    async () => {
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "currency_code",
          "email",
          "raw_total",
          "total",
          "items.id",
          "items.quantity",
          "items.tax_lines.code",
          "items.tax_lines.rate",
          "items.tax_lines.data",
          "shipping_address.first_name",
          "shipping_address.last_name",
          "shipping_address.address_1",
          "shipping_address.city",
          "shipping_address.postal_code",
          "shipping_address.country_code",
          "shipping_methods.id",
          "shipping_methods.tax_lines.code",
          "shipping_methods.tax_lines.rate",
          "shipping_methods.tax_lines.data",
          "payment_collection.amount",
          "payment_collection.raw_amount",
          "payment_collection.currency_code",
          "payment_collection.payment_sessions.id",
          "payment_collection.payment_sessions.amount",
          "payment_collection.payment_sessions.raw_amount",
          "payment_collection.payment_sessions.currency_code",
          "payment_collection.payment_sessions.provider_id",
          "payment_collection.payment_sessions.status",
          "payment_collection.payment_sessions.data",
        ],
        filters: { id: parsed.data.cart_id },
        pagination: { take: 1 },
      });
      const cart = data[0];
      if (!cart) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "The checkout cart was not found.",
        );
      }
      return bindCheckoutTaxToPayment({
        cart,
        client,
        service,
      });
    },
    { timeout: 8 },
  );

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    linked: true,
    provider: result.provider,
    generation: result.generation,
    replayed: result.replayed,
  });
};
