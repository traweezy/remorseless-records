import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { z } from "zod";

import type { TaxReportPeriod } from "./periods";
import {
  projectTaxRecords,
  summarizeDestinations,
  summarizeTaxRecords,
} from "./projection";
import type {
  TaxRecord,
  TaxRecordProvider,
  TaxRecordQuality,
  TaxRecordType,
} from "./types";

type UnknownRecord = Record<string, unknown>;

type QueryGraph = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
    pagination: {
      order: Record<string, "ASC" | "DESC">;
      skip: number;
      take: number;
    };
  }) => Promise<{ data: UnknownRecord[] }>;
};

const PAGE_SIZE = 250;
const MAX_ORDERS = 50_000;

const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "currency_code",
  "created_at",
  "canceled_at",
  "original_total",
  "raw_original_total",
  "original_subtotal",
  "raw_original_subtotal",
  "original_tax_total",
  "raw_original_tax_total",
  "shipping_address.city",
  "shipping_address.country_code",
  "shipping_address.postal_code",
  "shipping_address.province",
  "summary.paid_total",
  "summary.raw_paid_total",
  "items.id",
  "items.title",
  "items.original_subtotal",
  "items.raw_original_subtotal",
  "items.original_tax_total",
  "items.raw_original_tax_total",
  "items.tax_lines.code",
  "items.tax_lines.data",
  "items.tax_lines.provider_id",
  "items.tax_lines.rate",
  "shipping_methods.id",
  "shipping_methods.original_subtotal",
  "shipping_methods.raw_original_subtotal",
  "shipping_methods.original_tax_total",
  "shipping_methods.raw_original_tax_total",
  "shipping_methods.tax_lines.code",
  "shipping_methods.tax_lines.data",
  "shipping_methods.tax_lines.provider_id",
  "shipping_methods.tax_lines.rate",
  "payment_collections.payments.id",
  "payment_collections.payments.amount",
  "payment_collections.payments.captured_amount",
  "payment_collections.payments.raw_captured_amount",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  "payment_collections.payments.refunds.id",
  "payment_collections.payments.refunds.amount",
  "payment_collections.payments.refunds.raw_amount",
  "payment_collections.payments.refunds.created_at",
] as const;

const filtersSchema = z.object({
  limit: z.coerce.number().int().min(10).max(100).default(50),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  provider: z
    .enum(["all", "legacy", "mixed", "stripe_tax", "taxrate_io", "unknown"])
    .default("all"),
  q: z.string().trim().max(100).default(""),
  quality: z
    .enum(["all", "complete", "incomplete", "review"])
    .default("all"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "ALL" || /^[A-Z0-9-]{2,8}$/.test(value))
    .default("ALL"),
  type: z.enum(["all", "refund", "sale"]).default("all"),
});

export type TaxReportFilters = z.infer<typeof filtersSchema>;

export const parseTaxReportFilters = (
  searchParams: URLSearchParams,
): TaxReportFilters =>
  filtersSchema.parse({
    limit: searchParams.get("limit") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    provider: searchParams.get("provider") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    quality: searchParams.get("quality") ?? undefined,
    state: searchParams.get("state") ?? undefined,
    type: searchParams.get("type") ?? undefined,
  });

export const loadTaxReportOrders = async ({
  container,
  period,
}: {
  container: MedusaContainer;
  period: TaxReportPeriod;
}): Promise<{ orders: UnknownRecord[]; truncated: boolean }> => {
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY);
  const orders: UnknownRecord[] = [];

  while (orders.length < MAX_ORDERS) {
    const { data } = await query.graph({
      entity: "order",
      fields: [...ORDER_FIELDS],
      filters: {
        created_at: { $lt: period.endExclusive },
      },
      pagination: {
        order: { created_at: "DESC" },
        skip: orders.length,
        take: PAGE_SIZE,
      },
    });
    orders.push(...data);
    if (data.length < PAGE_SIZE) {
      return { orders, truncated: false };
    }
  }

  return { orders, truncated: true };
};

const matchesFilters = (
  record: TaxRecord,
  filters: TaxReportFilters,
): boolean => {
  if (
    filters.provider !== "all" &&
    record.provider !== (filters.provider as TaxRecordProvider)
  ) {
    return false;
  }
  if (
    filters.quality !== "all" &&
    record.quality !== (filters.quality as TaxRecordQuality)
  ) {
    return false;
  }
  if (
    filters.type !== "all" &&
    record.type !== (filters.type as TaxRecordType)
  ) {
    return false;
  }
  if (
    filters.state !== "ALL" &&
    record.destination.stateCode !== filters.state
  ) {
    return false;
  }
  if (!filters.q) {
    return true;
  }

  const query = filters.q.toLowerCase();
  return [
    record.displayId,
    record.orderId,
    record.refundId,
    record.destination.city,
    record.destination.county,
    record.destination.jurisdictionName,
    record.destination.postalCode,
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
};

export const buildTaxReport = async ({
  container,
  filters,
  period,
}: {
  container: MedusaContainer;
  filters: TaxReportFilters;
  period: TaxReportPeriod;
}) => {
  const loaded = await loadTaxReportOrders({ container, period });
  const allRecords = projectTaxRecords({ orders: loaded.orders, period });
  const filteredRecords = allRecords.filter((record) =>
    matchesFilters(record, filters),
  );
  const offset = (filters.page - 1) * filters.limit;

  return {
    destinations: summarizeDestinations(allRecords),
    filters: {
      currencies: [
        ...new Set(allRecords.map((record) => record.currencyCode)),
      ].sort(),
      providers: [...new Set(allRecords.map((record) => record.provider))].sort(),
      states: [
        ...new Set(
          allRecords
            .map((record) => record.destination.stateCode)
            .filter((state): state is string => Boolean(state)),
        ),
      ].sort(),
    },
    generatedAt: new Date().toISOString(),
    period,
    records: filteredRecords.slice(offset, offset + filters.limit),
    resultCount: filteredRecords.length,
    source: {
      medusaOrdersScanned: loaded.orders.length,
      truncated: loaded.truncated,
    },
    summaries: summarizeTaxRecords(allRecords),
  };
};

export const buildFullTaxReport = async ({
  container,
  period,
}: {
  container: MedusaContainer;
  period: TaxReportPeriod;
}) => {
  const loaded = await loadTaxReportOrders({ container, period });
  const records = projectTaxRecords({ orders: loaded.orders, period });
  return {
    destinations: summarizeDestinations(records),
    generatedAt: new Date().toISOString(),
    period,
    records,
    source: {
      medusaOrdersScanned: loaded.orders.length,
      truncated: loaded.truncated,
    },
    summaries: summarizeTaxRecords(records),
  };
};
