export const providerNames = ["taxrate_io", "stripe_tax"] as const;

export type ProviderName = (typeof providerNames)[number];

export const providerLabel = (provider: ProviderName): string =>
  provider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io";

export const canConfirmProviderSwitch = ({
  activeProvider,
  reason,
  saving,
  targetProvider,
  targetReady,
}: {
  activeProvider: ProviderName;
  reason: string;
  saving: boolean;
  targetProvider: ProviderName | null;
  targetReady: boolean;
}): boolean =>
  targetProvider !== null &&
  targetProvider !== activeProvider &&
  targetReady &&
  reason.trim().length >= 10 &&
  !saving;
