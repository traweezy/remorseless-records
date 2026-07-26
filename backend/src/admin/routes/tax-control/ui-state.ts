export const providerNames = ["taxrate_io", "stripe_tax"] as const;

export type ProviderName = (typeof providerNames)[number];

export type ProviderCardState = {
  active: boolean;
  highlighted: boolean;
  pending: boolean;
};

export const isProviderName = (value: string): value is ProviderName =>
  providerNames.some((provider) => provider === value);

export const providerLabel = (provider: ProviderName): string =>
  provider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io";

export const normalizeTargetProvider = (
  activeProvider: ProviderName,
  selectedProvider: ProviderName,
): ProviderName | null =>
  activeProvider === selectedProvider ? null : selectedProvider;

export const resolveProviderSelection = (
  activeProvider: ProviderName,
  targetProvider: ProviderName | null,
): ProviderName => targetProvider ?? activeProvider;

export const getProviderCardState = ({
  activeProvider,
  provider,
  targetProvider,
}: {
  activeProvider: ProviderName;
  provider: ProviderName;
  targetProvider: ProviderName | null;
}): ProviderCardState => {
  const active = provider === activeProvider;
  const pending = provider === targetProvider;

  return {
    active,
    highlighted: active || pending,
    pending,
  };
};

export const canReviewProviderSwitch = ({
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
