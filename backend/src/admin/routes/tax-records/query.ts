import {
  keepPreviousData,
  queryOptions,
  type QueryFunctionContext,
} from "@tanstack/react-query"
import { z } from "zod"

import {
  TAX_FILING_STATES,
  type TaxFilingState,
} from "../../../lib/tax-reporting/filing-states"
import type { TaxReportPeriod } from "../../../lib/tax-reporting/periods"
import type {
  TaxDestinationSummary,
  TaxRecord,
  TaxRecordCollectionMode,
  TaxRecordProvider,
  TaxRecordQuality,
  TaxRecordType,
  TaxReportSummary,
} from "../../../lib/tax-reporting/types"
import { requestAdminJson } from "../../lib/admin-request"

export type TaxRecordFilters = {
  collectionMode: "all" | TaxRecordCollectionMode
  limit: number
  page: number
  provider: "all" | TaxRecordProvider
  q: string
  quality: "all" | TaxRecordQuality
  type: "all" | TaxRecordType
}

export type TaxRecordsReport = {
  destinations: TaxDestinationSummary[]
  filingState: TaxFilingState
  filters: {
    collectionModes: TaxRecordCollectionMode[]
    currencies: string[]
    providers: TaxRecordProvider[]
    states: string[]
  }
  generatedAt: string
  period: TaxReportPeriod
  records: TaxRecord[]
  resultCount: number
  source: {
    medusaOrdersScanned: number
    scopedRecords: number
    truncated: boolean
    unassignedStateRecords: number
  }
  summaries: TaxReportSummary[]
  unassignedRecordExamples: {
    displayId: number
    occurredAt: string
    orderId: string
  }[]
}

type TaxRecordsQueryInput = {
  filingState: TaxFilingState
  filters: TaxRecordFilters
  period: {
    end: string
    start: string
  }
}

const currencyCodeSchema = z.string().regex(/^[a-z]{3}$/)
const decimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/)
const nullableTextSchema = z.string().min(1).nullable()
const taxRecordProviderSchema = z.enum([
  "legacy",
  "mixed",
  "not_applicable",
  "stripe_tax",
  "taxrate_io",
  "unknown",
])
const taxRecordCollectionModeSchema = z.enum(["collect", "disabled", "unknown"])
const taxRecordQualitySchema = z.enum(["complete", "incomplete", "review"])
const taxRecordTypeSchema = z.enum(["refund", "sale"])

const destinationSchema = z.object({
  city: nullableTextSchema,
  countryCode: nullableTextSchema,
  county: nullableTextSchema,
  jurisdictionLevel: nullableTextSchema,
  jurisdictionName: nullableTextSchema,
  postalCode: nullableTextSchema,
  stateCode: nullableTextSchema,
})

const taxRecordSchema: z.ZodType<TaxRecord> = z.object({
  collectionMode: taxRecordCollectionModeSchema,
  currencyCode: currencyCodeSchema,
  destination: destinationSchema,
  displayId: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative().nullable(),
  grossSales: decimalSchema,
  id: z.string().min(1),
  issues: z.array(z.string().min(1)),
  nontaxableSales: decimalSchema,
  occurredAt: z.string().min(1),
  orderId: z.string().min(1),
  provider: taxRecordProviderSchema,
  quality: taxRecordQualitySchema,
  refundId: nullableTextSchema,
  refundCreditTiming: z
    .enum(["prior_period", "same_period", "unknown"])
    .nullable(),
  refundTaxMethod: z.enum(["estimated", "exact"]).nullable(),
  taxAmount: decimalSchema,
  taxableSales: decimalSchema,
  taxCalculationId: nullableTextSchema,
  taxRatePercent: decimalSchema.nullable(),
  total: decimalSchema,
  type: taxRecordTypeSchema,
  unclassifiedSales: decimalSchema,
})

const taxDestinationSummarySchema: z.ZodType<TaxDestinationSummary> = z.object({
  ...destinationSchema.shape,
  currencyCode: currencyCodeSchema,
  grossSales: decimalSchema,
  netSales: decimalSchema,
  netTax: decimalSchema,
  nontaxableSales: decimalSchema,
  refundedSales: decimalSchema,
  refundedTax: decimalSchema,
  taxCollected: decimalSchema,
  taxRatePercent: decimalSchema.nullable(),
  taxableSales: decimalSchema,
  unclassifiedSales: decimalSchema,
})

const taxReportSummarySchema: z.ZodType<TaxReportSummary> = z.object({
  completeRecords: z.number().int().nonnegative(),
  currencyCode: currencyCodeSchema,
  disabledRecordCount: z.number().int().nonnegative(),
  grossSales: decimalSchema,
  incompleteRecords: z.number().int().nonnegative(),
  netSales: decimalSchema,
  netTax: decimalSchema,
  nontaxableSales: decimalSchema,
  orderCount: z.number().int().nonnegative(),
  priorPeriodRefundCount: z.number().int().nonnegative(),
  refundCount: z.number().int().nonnegative(),
  refundedSales: decimalSchema,
  refundedTax: decimalSchema,
  reviewRecords: z.number().int().nonnegative(),
  samePeriodRefundCount: z.number().int().nonnegative(),
  taxCollected: decimalSchema,
  taxableSales: decimalSchema,
  unclassifiedSales: decimalSchema,
})

export const taxRecordsReportSchema: z.ZodType<TaxRecordsReport> = z.object({
  destinations: z.array(taxDestinationSummarySchema),
  filingState: z.enum(TAX_FILING_STATES),
  filters: z.object({
    collectionModes: z.array(taxRecordCollectionModeSchema),
    currencies: z.array(currencyCodeSchema),
    providers: z.array(taxRecordProviderSchema),
    states: z.array(z.string().min(1)),
  }),
  generatedAt: z.string().min(1),
  period: z.object({
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endExclusive: z.string().min(1),
    label: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startInclusive: z.string().min(1),
    timeZone: z.literal("America/New_York"),
  }),
  records: z.array(taxRecordSchema),
  resultCount: z.number().int().nonnegative(),
  source: z.object({
    medusaOrdersScanned: z.number().int().nonnegative(),
    scopedRecords: z.number().int().nonnegative(),
    truncated: z.boolean(),
    unassignedStateRecords: z.number().int().nonnegative(),
  }),
  summaries: z.array(taxReportSummarySchema),
  unassignedRecordExamples: z.array(
    z.object({
      displayId: z.number().int().nonnegative(),
      occurredAt: z.string().min(1),
      orderId: z.string().min(1),
    })
  ),
})

export const TAX_RECORDS_QUERY_KEY = ["tax-records"] as const

const queryParameters = ({
  filingState,
  filters,
  period,
}: TaxRecordsQueryInput) => ({
  collection_mode: filters.collectionMode,
  end: period.end,
  filing_state: filingState,
  limit: filters.limit,
  page: filters.page,
  provider: filters.provider,
  q: filters.q,
  quality: filters.quality,
  start: period.start,
  type: filters.type,
})

export const taxRecordsQueryOptions = (input: TaxRecordsQueryInput) => {
  const query = queryParameters(input)
  const queryKey = [...TAX_RECORDS_QUERY_KEY, query] as const

  const loadTaxRecords = ({
    signal,
  }: QueryFunctionContext<typeof queryKey>): Promise<TaxRecordsReport> =>
    requestAdminJson({
      path: "/admin/tax-records",
      query,
      schema: taxRecordsReportSchema,
      signal,
      timeoutMs: 20_000,
    })

  return queryOptions({
    placeholderData: keepPreviousData,
    queryFn: loadTaxRecords,
    queryKey,
    retry: false,
    staleTime: 0,
  })
}
