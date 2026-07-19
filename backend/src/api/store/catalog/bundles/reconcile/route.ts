import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "zod";

import {
  reconcileBundleVariants,
  reconcileCartBundles,
} from "@/lib/catalog/bundle-inventory";

const reconcileSchema = z
  .object({
    cartId: z.string().trim().min(1).optional(),
    variantId: z.string().trim().min(1).optional(),
    quantity: z.number().int().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.cartId) !== Boolean(value.variantId), {
    message: "Provide exactly one of cartId or variantId",
  });

export const POST = async (
  req: MedusaStoreRequest,
  res: MedusaResponse,
): Promise<void> => {
  const parsed = reconcileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid bundle reconciliation payload",
    );
  }

  const salesChannelIds = req.publishable_key_context.sales_channel_ids;
  if (salesChannelIds.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Bundle inventory requires exactly one sales channel",
    );
  }
  const salesChannelId = salesChannelIds[0];
  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Bundle inventory sales channel is unavailable",
    );
  }

  const plans = parsed.data.cartId
    ? await reconcileCartBundles(req.scope, {
        cartId: parsed.data.cartId,
        salesChannelId,
      })
    : await reconcileBundleVariants(req.scope, {
        salesChannelId,
        quantitiesByVariantId: {
          [parsed.data.variantId ?? ""]: parsed.data.quantity ?? 1,
        },
      });

  res.status(200).json({
    reconciled: plans.length,
    selections: plans.flatMap((plan) =>
      plan.selectedAlternativeVariantIds.map((componentVariantId) => ({
        bundleVariantId: plan.bundleVariantId,
        componentVariantId,
      })),
    ),
  });
};
