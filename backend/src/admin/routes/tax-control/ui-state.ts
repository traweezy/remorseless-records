import { z } from "zod";

import { TAX_DISABLED_ACKNOWLEDGEMENT } from "../../../modules/tax-control/constants";

export const providerNames = ["taxrate_io", "stripe_tax"] as const;

export type ProviderName = (typeof providerNames)[number];

export const collectionModes = ["collect", "disabled"] as const;

export type CollectionMode = (typeof collectionModes)[number];

export const providerLabel = (provider: ProviderName): string =>
  provider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io";

const transitionReasonSchema = z
  .string()
  .trim()
  .min(10, "Enter at least 10 characters.")
  .max(500, "Enter no more than 500 characters.");

export const taxControlTransitionFormSchema = (
  targetCollectionMode: CollectionMode,
) =>
  z
    .object({
      acknowledgement: z.string().max(200),
      reason: transitionReasonSchema,
    })
    .superRefine((value, context) => {
      if (
        targetCollectionMode === "disabled" &&
        value.acknowledgement !== TAX_DISABLED_ACKNOWLEDGEMENT
      ) {
        context.addIssue({
          code: "custom",
          message: "Type the acknowledgement exactly as shown.",
          path: ["acknowledgement"],
        });
      }
    });

export const taxControlTransitionWasApplied = ({
  activeProvider,
  collectionMode,
  currentGeneration,
  expectedGeneration,
  targetCollectionMode,
  targetProvider,
}: {
  activeProvider: ProviderName | undefined;
  collectionMode: CollectionMode | undefined;
  currentGeneration: number | undefined;
  expectedGeneration: number;
  targetCollectionMode: CollectionMode;
  targetProvider: ProviderName;
}): boolean =>
  activeProvider === targetProvider &&
  collectionMode === targetCollectionMode &&
  currentGeneration !== undefined &&
  currentGeneration > expectedGeneration;

export const collectionChoiceLabel = (
  collectionMode: CollectionMode,
  provider: ProviderName,
): string =>
  collectionMode === "disabled"
    ? "Do not collect tax"
    : `Collect with ${providerLabel(provider)}`;
