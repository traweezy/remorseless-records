import { parseTaxLineCode, type TaxLineIdentity } from "./context";
import type { TaxProviderName } from "../../modules/tax-control/constants";
import type { TaxCollectionMode } from "../../modules/tax-control/constants";

type UnknownRecord = Record<string, unknown>;

export type TaxQuoteIdentity = {
  calculationId: string | null;
  collectionMode: TaxCollectionMode;
  fingerprint: string;
  generation: number;
  provider: TaxProviderName | null;
  taxRatePercent: number | null;
};

export class TaxQuoteIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxQuoteIdentityError";
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const taxLinesFrom = (subject: unknown): UnknownRecord[] => {
  const record = asRecord(subject);
  return (Array.isArray(record?.tax_lines) ? record.tax_lines : [])
    .map(asRecord)
    .filter((line): line is UnknownRecord => line !== null);
};

const taxSubjectsFrom = (cart: UnknownRecord): UnknownRecord[] =>
  [
    ...(Array.isArray(cart.items) ? cart.items : []),
    ...(Array.isArray(cart.shipping_methods) ? cart.shipping_methods : []),
  ]
    .map(asRecord)
    .filter((subject): subject is UnknownRecord => subject !== null);

const assertLineData = (
  line: UnknownRecord,
  codeIdentity: TaxLineIdentity,
): { fingerprint: string; rate: number } => {
  const data = asRecord(line.data);
  const provider = text(data?.provider);
  const collectionModeValue = text(data?.collection_mode);
  const collectionMode = collectionModeValue || "collect";
  const generation = Number(data?.generation);
  const fingerprint = text(data?.fingerprint);
  const calculationId = text(data?.calculation_id) || null;
  const rate = Number(line.rate);

  if (
    collectionMode !== codeIdentity.collectionMode ||
    (codeIdentity.collectionMode === "collect" &&
      provider !== codeIdentity.provider) ||
    (codeIdentity.collectionMode === "disabled" && provider !== "") ||
    !Number.isSafeInteger(generation) ||
    generation !== codeIdentity.generation ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(fingerprint) ||
    calculationId !== codeIdentity.calculationId ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    (codeIdentity.collectionMode === "disabled" && rate !== 0)
  ) {
    throw new TaxQuoteIdentityError(
      "A cart tax line has incomplete or inconsistent quote data.",
    );
  }

  return { fingerprint, rate };
};

export const taxQuoteIdentityFromCart = (value: unknown): TaxQuoteIdentity => {
  const cart = asRecord(value);
  if (!cart) {
    throw new TaxQuoteIdentityError("The cart tax snapshot is unavailable.");
  }

  const subjects = taxSubjectsFrom(cart);
  if (!subjects.length) {
    throw new TaxQuoteIdentityError("The cart has no taxable subjects.");
  }

  const taxLines = subjects.flatMap((subject) => {
    const lines = taxLinesFrom(subject);
    if (!lines.length) {
      throw new TaxQuoteIdentityError(
        "Every cart item and shipping method must have a tax quote.",
      );
    }
    return lines;
  });

  const identities = taxLines.map((line) => {
    const identity = parseTaxLineCode(line.code);
    if (!identity) {
      throw new TaxQuoteIdentityError(
        "A cart tax line was not created by the controlled tax provider.",
      );
    }
    return { identity, ...assertLineData(line, identity) };
  });
  const first = identities[0];
  if (!first) {
    throw new TaxQuoteIdentityError("The cart tax quote is unavailable.");
  }

  if (
    identities.some(
      (entry) =>
        entry.identity.collectionMode !== first.identity.collectionMode ||
        entry.identity.provider !== first.identity.provider ||
        entry.identity.generation !== first.identity.generation ||
        entry.identity.calculationId !== first.identity.calculationId ||
        entry.fingerprint !== first.fingerprint,
    )
  ) {
    throw new TaxQuoteIdentityError(
      "The cart contains tax lines from different quote generations.",
    );
  }

  if (
    first.identity.collectionMode === "collect" &&
    first.identity.provider === "stripe_tax" &&
    !first.identity.calculationId
  ) {
    throw new TaxQuoteIdentityError(
      "The Stripe Tax calculation identity is unavailable.",
    );
  }

  const rates = new Set(identities.map((entry) => entry.rate));
  if (
    first.identity.collectionMode === "collect" &&
    first.identity.provider === "taxrate_io" &&
    rates.size !== 1
  ) {
    throw new TaxQuoteIdentityError(
      "The TaxRate.io quote contains inconsistent rates.",
    );
  }

  return {
    calculationId: first.identity.calculationId,
    collectionMode: first.identity.collectionMode,
    fingerprint: first.fingerprint,
    generation: first.identity.generation,
    provider: first.identity.provider,
    taxRatePercent:
      first.identity.collectionMode === "collect" &&
      first.identity.provider === "taxrate_io"
        ? first.rate
        : null,
  };
};
