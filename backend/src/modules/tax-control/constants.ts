export const taxProviderNames = ["taxrate_io", "stripe_tax"] as const;

export type TaxProviderName = (typeof taxProviderNames)[number];

export const taxQuoteEvidenceStatuses = [
  "prepared",
  "succeeded",
  "canceled",
  "failed",
  "association_failed",
  "disputed",
  "partially_refunded",
  "refunded",
] as const;

export type TaxQuoteEvidenceStatus = (typeof taxQuoteEvidenceStatuses)[number];

export const TAX_CONTROL_ID = "taxctrl_default";
export const TAXRATE_IO_QUOTA_ID = "taxquota_taxrate_io";
export const TAX_CONTROL_LOCK_KEY = "tax-control:provider-switch";
export const TAXRATE_IO_QUOTA_REDIS_KEY = "tax-control:taxrate-io:quota";
export const taxBindingLockKey = (cartId: string): string =>
  `tax-control:payment-binding:${cartId}`;
export const taxEvidenceLockKey = (paymentIntentId: string): string =>
  `tax-control:evidence:${paymentIntentId}`;

export const isTaxProviderName = (value: unknown): value is TaxProviderName =>
  typeof value === "string" &&
  taxProviderNames.includes(value as TaxProviderName);
