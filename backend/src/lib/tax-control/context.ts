import { createHash } from "node:crypto";

import {
  isTaxProviderName,
  type TaxProviderName,
} from "../../modules/tax-control/constants";

export const TAX_CONTEXT_KEY = "remorseless_tax";
export const TAX_LINE_CODE_PREFIX = "rr_tax";

export type FrozenTaxQuote = {
  provider: TaxProviderName;
  generation: number;
  stripeCalculationId?: string;
  taxRatePercent?: number;
};

export type TaxControlContext = {
  fingerprint: string;
  frozenQuote?: FrozenTaxQuote;
  generation: number;
  itemAmountsMinor: Record<string, number>;
  itemTaxCodes: Record<string, string>;
  preservedItemRates: Record<string, number>;
  preservedShippingRates: Record<string, number>;
  provider: TaxProviderName;
  shippingAmountMinor: number;
  subjectId: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const optionalFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const taxCodesFrom = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] =>
        /^.+$/.test(entry[0]) &&
        typeof entry[1] === "string" &&
        /^txcd_\d{8}$/.test(entry[1]),
    ),
  );
};

const minorUnitAmountsFrom = (value: unknown): Record<string, number> => {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, amount]) => [key, Number(amount)] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          Boolean(entry[0]) && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
      ),
  );
};

const finiteNumbersFrom = (value: unknown): Record<string, number> => {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, number]) => [key, Number(number)] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          Boolean(entry[0]) && Number.isFinite(entry[1]) && entry[1] >= 0,
      ),
  );
};

const frozenQuoteFrom = (value: unknown): FrozenTaxQuote | undefined => {
  const record = asRecord(value);
  if (!record || !isTaxProviderName(record.provider)) {
    return undefined;
  }

  const generation = positiveInteger(record.generation);
  if (!generation) {
    return undefined;
  }

  const stripeCalculationId =
    typeof record.stripeCalculationId === "string" &&
    /^taxcalc_[A-Za-z0-9]+$/.test(record.stripeCalculationId)
      ? record.stripeCalculationId
      : undefined;
  const taxRatePercent = optionalFiniteNumber(record.taxRatePercent);

  return {
    provider: record.provider,
    generation,
    ...(stripeCalculationId ? { stripeCalculationId } : {}),
    ...(taxRatePercent !== undefined ? { taxRatePercent } : {}),
  };
};

export const parseTaxControlContext = (
  additionalContext: Record<string, unknown> | undefined,
): TaxControlContext => {
  const record = asRecord(additionalContext?.[TAX_CONTEXT_KEY]);
  if (!record || !isTaxProviderName(record.provider)) {
    throw new Error("Tax provider control context is missing.");
  }

  const generation = positiveInteger(record.generation);
  const subjectId =
    typeof record.subjectId === "string" && record.subjectId.trim()
      ? record.subjectId.trim()
      : null;
  const fingerprint =
    typeof record.fingerprint === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(record.fingerprint)
      ? record.fingerprint
      : null;
  const shippingAmountMinor = Number(record.shippingAmountMinor ?? 0);
  if (
    !generation ||
    !subjectId ||
    !fingerprint ||
    !Number.isSafeInteger(shippingAmountMinor) ||
    shippingAmountMinor < 0
  ) {
    throw new Error("Tax provider control context is invalid.");
  }

  const frozenQuote = frozenQuoteFrom(record.frozenQuote);
  if (
    frozenQuote &&
    (frozenQuote.provider !== record.provider ||
      frozenQuote.generation !== generation)
  ) {
    throw new Error("Frozen tax quote does not match its provider generation.");
  }

  return {
    fingerprint,
    generation,
    itemAmountsMinor: minorUnitAmountsFrom(record.itemAmountsMinor),
    itemTaxCodes: taxCodesFrom(record.itemTaxCodes),
    preservedItemRates: finiteNumbersFrom(record.preservedItemRates),
    preservedShippingRates: finiteNumbersFrom(record.preservedShippingRates),
    provider: record.provider,
    shippingAmountMinor,
    subjectId,
    ...(frozenQuote ? { frozenQuote } : {}),
  };
};

export const createTaxContextFingerprint = (
  value: Record<string, unknown>,
): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("base64url");

export const buildTaxLineCode = ({
  calculationId,
  generation,
  provider,
}: {
  calculationId?: string;
  generation: number;
  provider: TaxProviderName;
}): string =>
  [
    TAX_LINE_CODE_PREFIX,
    provider,
    `g${generation}`,
    calculationId ?? "quote",
  ].join(":");

export type TaxLineIdentity = {
  calculationId: string | null;
  generation: number;
  provider: TaxProviderName;
};

export const parseTaxLineCode = (value: unknown): TaxLineIdentity | null => {
  if (typeof value !== "string") {
    return null;
  }

  const [prefix, provider, generationValue, calculationId, ...rest] =
    value.split(":");
  if (
    rest.length ||
    prefix !== TAX_LINE_CODE_PREFIX ||
    !isTaxProviderName(provider) ||
    !generationValue?.startsWith("g")
  ) {
    return null;
  }

  const generation = positiveInteger(generationValue.slice(1));
  if (!generation) {
    return null;
  }

  return {
    calculationId:
      calculationId && /^taxcalc_[A-Za-z0-9]+$/.test(calculationId)
        ? calculationId
        : null,
    generation,
    provider,
  };
};
