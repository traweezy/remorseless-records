import { getOrdersListWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"

import { TAX_FILING_STATES, type TaxFilingScope } from "./filing-states"
import type { TaxReportPeriod } from "./periods"
import {
  diagnoseTaxProjection,
  projectTaxRecords,
  summarizeDestinations,
  summarizeTaxRecords,
} from "./projection"
import type {
  TaxRecord,
  TaxRecordProvider,
  TaxRecordQuality,
  TaxRecordType,
} from "./types"

type UnknownRecord = Record<string, unknown>

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
    pagination: {
      order: Record<string, "ASC" | "DESC">
      skip: number
      take: number
    }
  }) => Promise<{ data: UnknownRecord[] }>
}

const PAGE_SIZE = 250
const MAX_ORDERS = 50_000
const PAYMENT_QUERY_CONCURRENCY = 4

const ORDER_TOTAL_FIELDS = [
  "id",
  "original_total",
  "raw_original_total",
  "original_subtotal",
  "raw_original_subtotal",
  "original_tax_total",
  "raw_original_tax_total",
  "original_item_subtotal",
  "raw_original_item_subtotal",
  "original_item_tax_total",
  "raw_original_item_tax_total",
  "original_shipping_subtotal",
  "raw_original_shipping_subtotal",
  "original_shipping_tax_total",
  "raw_original_shipping_tax_total",
] as const

const PAYMENT_FIELDS = [
  "id",
  "amount",
  "raw_amount",
  "captured_at",
  "provider_id",
  "data",
  "captures.id",
  "captures.amount",
  "captures.raw_amount",
  "captures.created_at",
  "refunds.id",
  "refunds.amount",
  "refunds.raw_amount",
  "refunds.created_at",
] as const

const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "currency_code",
  "created_at",
  "canceled_at",
  "summary",
  "*shipping_address",
  "*items",
  "*items.tax_lines",
  "*shipping_methods",
  "*shipping_methods.tax_lines",
  "*payment_collections",
  "*payment_collections.payments",
  "*payment_collections.payments.refunds",
  "*payment_collections.payments.captures",
  ...ORDER_TOTAL_FIELDS,
  "shipping_address.city",
  "shipping_address.country_code",
  "shipping_address.postal_code",
  "shipping_address.province",
  "summary.paid_total",
  "summary.raw_paid_total",
  "summary.original_order_total",
  "summary.raw_original_order_total",
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
  "payment_collections.id",
  "payment_collections.status",
  "payment_collections.amount",
  "payment_collections.raw_amount",
  "payment_collections.payments.id",
  "payment_collections.payments.amount",
  "payment_collections.payments.raw_amount",
  "payment_collections.payments.captured_amount",
  "payment_collections.payments.raw_captured_amount",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.captures.id",
  "payment_collections.payments.captures.amount",
  "payment_collections.payments.captures.raw_amount",
  "payment_collections.payments.captures.created_at",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  "payment_collections.payments.refunds.id",
  "payment_collections.payments.refunds.amount",
  "payment_collections.payments.refunds.raw_amount",
  "payment_collections.payments.refunds.created_at",
  "payment_collections.captured_amount",
  "payment_collections.raw_captured_amount",
] as const

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((record): record is UnknownRecord => record !== null)
    : []

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const workflowRows = (
  result:
    | {
        rows: unknown[]
      }
    | unknown[]
): UnknownRecord[] =>
  (Array.isArray(result) ? result : result.rows) as UnknownRecord[]

const mergeAuthoritativeTotals = ({
  orders,
  totals,
}: {
  orders: UnknownRecord[]
  totals: UnknownRecord[]
}): UnknownRecord[] => {
  const totalsById = new Map(
    totals.flatMap((order) => {
      const id = text(order.id)
      return id ? [[id, order] as const] : []
    })
  )
  return orders.map((order) => {
    const id = text(order.id)
    const authoritative = id ? totalsById.get(id) : undefined
    if (!id || !authoritative) {
      throw new Error(
        "Tax report could not load authoritative totals for every order."
      )
    }
    return Object.fromEntries(
      Object.entries(order).concat(
        ORDER_TOTAL_FIELDS.flatMap((field) =>
          field in authoritative
            ? ([[field, authoritative[field]]] as const)
            : []
        )
      )
    )
  })
}

const paymentIdsFrom = (orders: UnknownRecord[]): string[] => [
  ...new Set(
    orders.flatMap((order) =>
      records(order.payment_collections).flatMap((collection) =>
        records(collection.payments)
          .map((payment) => text(payment.id))
          .filter((id): id is string => id !== null)
      )
    )
  ),
]

const loadPayments = async ({
  paymentIds,
  query,
}: {
  paymentIds: string[]
  query: QueryGraph
}): Promise<Map<string, UnknownRecord>> => {
  const paymentsById = new Map<string, UnknownRecord>()
  const batches = Array.from(
    { length: Math.ceil(paymentIds.length / PAGE_SIZE) },
    (_, index) => paymentIds.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)
  )
  for (
    let offset = 0;
    offset < batches.length;
    offset += PAYMENT_QUERY_CONCURRENCY
  ) {
    const results = await Promise.all(
      batches
        .slice(offset, offset + PAYMENT_QUERY_CONCURRENCY)
        .map(async (ids) =>
          query.graph({
            entity: "payment",
            fields: [...PAYMENT_FIELDS],
            filters: { id: ids },
            pagination: {
              order: { created_at: "DESC" },
              skip: 0,
              take: ids.length,
            },
          })
        )
    )
    for (const { data } of results) {
      for (const payment of data) {
        const id = text(payment.id)
        if (id) {
          paymentsById.set(id, payment)
        }
      }
    }
  }
  if (paymentIds.some((id) => !paymentsById.has(id))) {
    throw new Error("Tax report could not load every linked payment record.")
  }
  return paymentsById
}

const hydrateOrderPayments = async ({
  orders,
  query,
}: {
  orders: UnknownRecord[]
  query: QueryGraph
}): Promise<UnknownRecord[]> => {
  const paymentIds = paymentIdsFrom(orders)
  if (!paymentIds.length) {
    return orders
  }
  const paymentsById = await loadPayments({ paymentIds, query })
  return orders.map((order) => ({
    ...order,
    payment_collections: records(order.payment_collections).map(
      (collection) => ({
        ...collection,
        payments: records(collection.payments).map((payment) => {
          const id = text(payment.id)
          const hydrated = id ? paymentsById.get(id) : undefined
          return hydrated ? { ...payment, ...hydrated } : payment
        }),
      })
    ),
  }))
}

const relationshipDiagnostics = (
  orders: UnknownRecord[]
): {
  ordersWithItems: number
  ordersWithPaymentCollections: number
  ordersWithPayments: number
  ordersWithShippingAddress: number
  ordersWithSummary: number
  paymentCollections: number
  payments: number
} => {
  const collections = orders.flatMap((order) =>
    records(order.payment_collections)
  )
  const linkedPayments = collections.flatMap((collection) =>
    records(collection.payments)
  )
  return {
    ordersWithItems: orders.filter((order) => records(order.items).length > 0)
      .length,
    ordersWithPaymentCollections: orders.filter(
      (order) => records(order.payment_collections).length > 0
    ).length,
    ordersWithPayments: orders.filter((order) =>
      records(order.payment_collections).some(
        (collection) => records(collection.payments).length > 0
      )
    ).length,
    ordersWithShippingAddress: orders.filter(
      (order) => asRecord(order.shipping_address) !== null
    ).length,
    ordersWithSummary: orders.filter(
      (order) => asRecord(order.summary) !== null
    ).length,
    paymentCollections: collections.length,
    payments: linkedPayments.length,
  }
}

const filtersSchema = z.object({
  collectionMode: z
    .enum(["all", "collect", "disabled", "unknown"])
    .default("all"),
  filingState: z.enum(["ALL", ...TAX_FILING_STATES]).default("ALL"),
  limit: z.coerce.number().int().min(10).max(100).default(50),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  provider: z
    .enum([
      "all",
      "legacy",
      "mixed",
      "not_applicable",
      "stripe_tax",
      "taxrate_io",
      "unknown",
    ])
    .default("all"),
  q: z.string().trim().max(100).default(""),
  quality: z.enum(["all", "complete", "incomplete", "review"]).default("all"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "ALL" || /^[A-Z0-9-]{2,8}$/.test(value))
    .default("ALL"),
  type: z.enum(["all", "refund", "sale"]).default("all"),
})

export type TaxReportFilters = z.infer<typeof filtersSchema>

export const parseTaxFilingState = (value: unknown): TaxFilingScope =>
  z
    .enum(["ALL", ...TAX_FILING_STATES])
    .default("ALL")
    .parse(value)

export const parseTaxReportFilters = (
  searchParams: URLSearchParams
): TaxReportFilters =>
  filtersSchema.parse({
    collectionMode: searchParams.get("collection_mode") ?? undefined,
    filingState: searchParams.get("filing_state") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    provider: searchParams.get("provider") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    quality: searchParams.get("quality") ?? undefined,
    state: searchParams.get("state") ?? undefined,
    type: searchParams.get("type") ?? undefined,
  })

export const loadTaxReportOrders = async ({
  container,
  period,
}: {
  container: MedusaContainer
  period: TaxReportPeriod
}): Promise<{ orders: UnknownRecord[]; truncated: boolean }> => {
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const orderListWorkflow = getOrdersListWorkflow(container)
  const orders: UnknownRecord[] = []

  while (orders.length < MAX_ORDERS) {
    const variables = {
      created_at: { $lt: period.endExclusive },
      order: { created_at: "DESC" as const },
      skip: orders.length,
      take: PAGE_SIZE,
    }
    const [{ result }, { result: totalsResult }] = await Promise.all([
      orderListWorkflow.run({
        input: {
          fields: [...ORDER_FIELDS],
          variables,
        },
      }),
      orderListWorkflow.run({
        input: {
          fields: [...ORDER_TOTAL_FIELDS],
          variables,
        },
      }),
    ])
    const data = mergeAuthoritativeTotals({
      orders: workflowRows(result as { rows: unknown[] } | unknown[]),
      totals: workflowRows(totalsResult as { rows: unknown[] } | unknown[]),
    })
    orders.push(...data)
    if (data.length < PAGE_SIZE) {
      return {
        orders: await hydrateOrderPayments({ orders, query }),
        truncated: false,
      }
    }
  }

  return {
    orders: await hydrateOrderPayments({ orders, query }),
    truncated: true,
  }
}

const matchesFilters = (
  record: TaxRecord,
  filters: TaxReportFilters
): boolean => {
  if (
    filters.collectionMode !== "all" &&
    record.collectionMode !== filters.collectionMode
  ) {
    return false
  }
  if (
    filters.provider !== "all" &&
    record.provider !== (filters.provider as TaxRecordProvider)
  ) {
    return false
  }
  if (
    filters.quality !== "all" &&
    record.quality !== (filters.quality as TaxRecordQuality)
  ) {
    return false
  }
  if (
    filters.type !== "all" &&
    record.type !== (filters.type as TaxRecordType)
  ) {
    return false
  }
  if (
    filters.state !== "ALL" &&
    record.destination.stateCode !== filters.state
  ) {
    return false
  }
  if (!filters.q) {
    return true
  }

  const query = filters.q.toLowerCase()
  return [
    record.displayId,
    record.orderId,
    record.refundId,
    record.destination.city,
    record.destination.county,
    record.destination.jurisdictionName,
    record.destination.postalCode,
  ].some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query)
  )
}

const recordsForFilingState = (
  records: TaxRecord[],
  filingState: TaxFilingScope
): TaxRecord[] =>
  filingState === "ALL"
    ? records
    : records.filter(
        (record) =>
          (!record.destination.countryCode ||
            record.destination.countryCode === "US") &&
          record.destination.stateCode === filingState
      )

const unassignedFilingRecords = (records: TaxRecord[]): TaxRecord[] =>
  records.filter(
    (record) =>
      (!record.destination.countryCode ||
        record.destination.countryCode === "US") &&
      !record.destination.stateCode
  )

export const buildTaxReport = async ({
  container,
  filters,
  period,
}: {
  container: MedusaContainer
  filters: TaxReportFilters
  period: TaxReportPeriod
}) => {
  const loaded = await loadTaxReportOrders({ container, period })
  const allRecords = projectTaxRecords({ orders: loaded.orders, period })
  const scopedRecords = recordsForFilingState(allRecords, filters.filingState)
  const unassignedRecords = unassignedFilingRecords(allRecords)
  const filteredRecords = scopedRecords.filter((record) =>
    matchesFilters(record, filters)
  )
  const offset = (filters.page - 1) * filters.limit

  return {
    destinations: summarizeDestinations(scopedRecords),
    filingState: filters.filingState,
    filters: {
      collectionModes: [
        ...new Set(scopedRecords.map((record) => record.collectionMode)),
      ].sort(),
      currencies: [
        ...new Set(scopedRecords.map((record) => record.currencyCode)),
      ].sort(),
      providers: [
        ...new Set(scopedRecords.map((record) => record.provider)),
      ].sort(),
      states: [
        ...new Set(
          scopedRecords
            .map((record) => record.destination.stateCode)
            .filter((state): state is string => Boolean(state))
        ),
      ].sort(),
    },
    generatedAt: new Date().toISOString(),
    period,
    records: filteredRecords.slice(offset, offset + filters.limit),
    resultCount: filteredRecords.length,
    source: {
      medusaOrdersScanned: loaded.orders.length,
      projectedRecords: allRecords.length,
      projectionDiagnostics:
        allRecords.length === 0
          ? diagnoseTaxProjection({ orders: loaded.orders, period })
          : null,
      relationships: relationshipDiagnostics(loaded.orders),
      scopedRecords: scopedRecords.length,
      truncated: loaded.truncated,
      unassignedStateRecords: unassignedRecords.length,
    },
    summaries: summarizeTaxRecords(scopedRecords),
    unassignedRecordExamples: unassignedRecords
      .slice(0, 25)
      .map(({ displayId, occurredAt, orderId }) => ({
        displayId,
        occurredAt,
        orderId,
      })),
  }
}

export const buildFullTaxReport = async ({
  container,
  filingState = "ALL",
  period,
}: {
  container: MedusaContainer
  filingState?: TaxFilingScope
  period: TaxReportPeriod
}) => {
  const loaded = await loadTaxReportOrders({ container, period })
  const allRecords = projectTaxRecords({ orders: loaded.orders, period })
  const records = recordsForFilingState(allRecords, filingState)
  const unassignedRecords = unassignedFilingRecords(allRecords)
  return {
    destinations: summarizeDestinations(records),
    filingState,
    generatedAt: new Date().toISOString(),
    period,
    records,
    source: {
      medusaOrdersScanned: loaded.orders.length,
      projectedRecords: allRecords.length,
      projectionDiagnostics:
        allRecords.length === 0
          ? diagnoseTaxProjection({ orders: loaded.orders, period })
          : null,
      relationships: relationshipDiagnostics(loaded.orders),
      scopedRecords: records.length,
      truncated: loaded.truncated,
      unassignedStateRecords: unassignedRecords.length,
    },
    summaries: summarizeTaxRecords(records),
  }
}
