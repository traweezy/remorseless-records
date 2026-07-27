import { z } from "zod";

export const providerNames = ["taxrate_io", "stripe_tax"] as const;

export type ProviderName = (typeof providerNames)[number];

export const providerLabel = (provider: ProviderName): string =>
  provider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io";

export const taxProviderSwitchFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Enter at least 10 characters.")
    .max(500, "Enter no more than 500 characters."),
});

export const providerSwitchWasApplied = ({
  activeProvider,
  currentGeneration,
  expectedGeneration,
  targetProvider,
}: {
  activeProvider: ProviderName | undefined;
  currentGeneration: number | undefined;
  expectedGeneration: number;
  targetProvider: ProviderName;
}): boolean =>
  activeProvider === targetProvider &&
  currentGeneration !== undefined &&
  currentGeneration > expectedGeneration;
