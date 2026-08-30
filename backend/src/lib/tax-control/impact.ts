import type { TaxProviderName } from "../../modules/tax-control/constants";

type UnknownRecord = Record<string, unknown>;

export type TaxControlImpactQuery = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: {
      order?: Record<string, "ASC" | "DESC">;
      skip?: number;
      take?: number;
    };
  }) => Promise<{
    data: UnknownRecord[];
    metadata?: {
      count?: number;
      skip?: number;
      take?: number;
    };
  }>;
};

export type TaxControlImpact = {
  activityWindowDays: number;
  frozenByCollectionMode: Record<"collect" | "disabled", number>;
  frozenByProvider: Record<TaxProviderName, number>;
  paymentsFinalizing: number;
  preparedCheckouts: number;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_DAYS = 30;
const PAGE_SIZE = 250;

const PROCESSABLE_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
]);

const FINALIZING_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending_authorization",
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const summarizeTaxControlImpact = (
  carts: UnknownRecord[],
): TaxControlImpact => {
  let preparedCheckouts = 0;
  let paymentsFinalizing = 0;
  const frozenByProvider: Record<TaxProviderName, number> = {
    stripe_tax: 0,
    taxrate_io: 0,
  };
  const frozenByCollectionMode = { collect: 0, disabled: 0 };

  for (const cart of carts) {
    const collection = asRecord(cart.payment_collection);
    const sessions = Array.isArray(collection?.payment_sessions)
      ? collection.payment_sessions
      : [];
    let prepared = false;
    let finalizing = false;
    let frozenProvider: TaxProviderName | null = null;
    let frozenCollectionMode: "collect" | "disabled" | null = null;

    for (const value of sessions) {
      const session = asRecord(value);
      if (text(session?.provider_id) !== "pp_stripe_stripe") {
        continue;
      }
      const status = text(session?.status) ?? "";
      if (PROCESSABLE_PAYMENT_STATUSES.has(status)) {
        prepared = true;
      }
      if (FINALIZING_PAYMENT_STATUSES.has(status)) {
        finalizing = true;
      }
      const sessionData = asRecord(session?.data);
      const metadata = asRecord(sessionData?.metadata);
      const provider = text(metadata?.rr_tax_provider);
      const collectionMode = text(metadata?.rr_tax_collection_mode);
      if (collectionMode === "disabled") {
        frozenCollectionMode = "disabled";
      } else if (
        collectionMode === "collect" ||
        provider === "stripe_tax" ||
        provider === "taxrate_io"
      ) {
        frozenCollectionMode = "collect";
      }
      if (provider === "stripe_tax" || provider === "taxrate_io") {
        frozenProvider = provider;
      }
    }

    if (prepared) {
      preparedCheckouts += 1;
    }
    if (finalizing) {
      paymentsFinalizing += 1;
    }
    if (prepared && frozenProvider) {
      frozenByProvider[frozenProvider] += 1;
    }
    if (prepared && frozenCollectionMode) {
      frozenByCollectionMode[frozenCollectionMode] += 1;
    }
  }

  return {
    activityWindowDays: ACTIVITY_WINDOW_DAYS,
    frozenByCollectionMode,
    frozenByProvider,
    paymentsFinalizing,
    preparedCheckouts,
  };
};

export const loadTaxControlImpact = async (
  query: TaxControlImpactQuery,
  now = new Date(),
): Promise<TaxControlImpact> => {
  const activeSince = new Date(
    now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS,
  ).toISOString();
  const carts: UnknownRecord[] = [];
  let skip = 0;

  while (true) {
    const result = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.payment_sessions.data",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.status",
      ],
      filters: {
        completed_at: null,
        updated_at: { $gte: activeSince },
      },
      pagination: {
        order: { updated_at: "DESC" },
        skip,
        take: PAGE_SIZE,
      },
    });
    carts.push(...result.data);

    const total = result.metadata?.count;
    if (
      result.data.length === 0 ||
      result.data.length < PAGE_SIZE ||
      (typeof total === "number" && carts.length >= total)
    ) {
      break;
    }
    skip += result.data.length;
  }

  return summarizeTaxControlImpact(carts);
};
