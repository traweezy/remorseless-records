import { queryOptions, type QueryFunctionContext } from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"
import {
  collectionModes,
  providerNames,
  type CollectionMode,
  type ProviderName,
} from "./ui-state"

export type ReadinessCheck = {
  detail: string
  id: string
  label: string
  ready: boolean
}

export type ProviderReadiness = {
  checks: ReadinessCheck[]
  configured: boolean
  message: string
  ready: boolean
}

export type TaxControlSnapshot = {
  audits: Array<{
    acknowledgementVersion: string
    actorId: string
    createdAt: string | null
    fromCollectionMode: CollectionMode
    fromGeneration: number
    fromProvider: ProviderName
    id: string
    reason: string
    toCollectionMode: CollectionMode
    toGeneration: number
    toProvider: ProviderName
  }>
  control: {
    activeProvider: ProviderName
    collectionMode: CollectionMode
    generation: number
    lastSwitchReason: string | null
    lastSwitchedAt: string | null
    lastSwitchedBy: string | null
  }
  evidence: {
    incidents: Array<{
      associationStatus: string | null
      currencyCode: string
      id: string
      lastVerifiedAt: string | null
      medusaRefundAmountMinor: number | null
      orderId: string | null
      paymentIntentId: string
      provider: ProviderName | null
      status:
        | "association_failed"
        | "disputed"
        | "refund_ledger_mismatch"
        | "refund_pending"
      stripeEvidenceAvailable: boolean
      stripeRefundAmountMinor: number | null
    }>
    needsAttention: number
    pendingRefundReversals: number
    prepared: number
    refundLedger: {
      available: boolean
      checked: number
      mismatches: number
      truncated: boolean
    }
    refunds: number
    succeeded: number
    tracked: number
  }
  impact: {
    activityWindowDays: number
    frozenByCollectionMode: Record<CollectionMode, number>
    frozenByProvider: Record<ProviderName, number>
    paymentsFinalizing: number
    preparedCheckouts: number
  }
  providers: {
    stripeTax: ProviderReadiness & {
      accountMode: "live" | "sandbox" | "unknown"
      activeRegistrationCount: number
      missingFields: string[]
    }
    taxRateIo: ProviderReadiness & {
      manualRefreshConfigured: boolean
      quota: {
        observedAt: string | null
        quota: number
        remaining: number
        source: string
        usage: number
        usagePercent: number
      } | null
    }
  }
}

type TaxControlTransitionBase = {
  expectedGeneration: number
  idempotencyKey: string
  reason: string
  targetProvider: ProviderName
}

export type TaxControlTransitionInput = TaxControlTransitionBase &
  (
    | {
        acknowledgement: string
        targetCollectionMode: "disabled"
      }
    | {
        acknowledgement?: never
        targetCollectionMode: "collect"
      }
  )

const nonEmptyTextSchema = z.string().min(1)
const nullableTextSchema = nonEmptyTextSchema.nullable()
const nonnegativeIntegerSchema = z.number().int().nonnegative()
const positiveIntegerSchema = z.number().int().positive()
const providerNameSchema = z.enum(providerNames)
const collectionModeSchema = z.enum(collectionModes)

const readinessCheckSchema: z.ZodType<ReadinessCheck> = z.object({
  detail: nonEmptyTextSchema,
  id: nonEmptyTextSchema,
  label: nonEmptyTextSchema,
  ready: z.boolean(),
})

const providerReadinessShape = {
  checks: z.array(readinessCheckSchema),
  configured: z.boolean(),
  message: nonEmptyTextSchema,
  ready: z.boolean(),
} as const

const enforceProviderReadiness = (
  readiness: ProviderReadiness,
  context: z.RefinementCtx
): void => {
  if (readiness.ready && !readiness.configured) {
    context.addIssue({
      code: "custom",
      message: "An unconfigured tax provider cannot be ready.",
      path: ["ready"],
    })
  }
  if (readiness.ready && readiness.checks.some((check) => !check.ready)) {
    context.addIssue({
      code: "custom",
      message: "A ready tax provider cannot contain a failed check.",
      path: ["checks"],
    })
  }
}

export const taxControlSnapshotSchema: z.ZodType<TaxControlSnapshot> = z.object(
  {
    audits: z.array(
      z.object({
        acknowledgementVersion: nonEmptyTextSchema,
        actorId: nonEmptyTextSchema,
        createdAt: nullableTextSchema,
        fromCollectionMode: collectionModeSchema,
        fromGeneration: positiveIntegerSchema,
        fromProvider: providerNameSchema,
        id: nonEmptyTextSchema,
        reason: nonEmptyTextSchema,
        toCollectionMode: collectionModeSchema,
        toGeneration: positiveIntegerSchema,
        toProvider: providerNameSchema,
      })
    ),
    control: z.object({
      activeProvider: providerNameSchema,
      collectionMode: collectionModeSchema,
      generation: positiveIntegerSchema,
      lastSwitchReason: nullableTextSchema,
      lastSwitchedAt: nullableTextSchema,
      lastSwitchedBy: nullableTextSchema,
    }),
    evidence: z.object({
      incidents: z.array(
        z.object({
          associationStatus: z.string().nullable(),
          currencyCode: z.string().regex(/^[a-z]{3}$/),
          id: nonEmptyTextSchema,
          lastVerifiedAt: nullableTextSchema,
          medusaRefundAmountMinor: nonnegativeIntegerSchema.nullable(),
          orderId: nullableTextSchema,
          paymentIntentId: nonEmptyTextSchema,
          provider: providerNameSchema.nullable(),
          status: z.enum([
            "association_failed",
            "disputed",
            "refund_ledger_mismatch",
            "refund_pending",
          ]),
          stripeEvidenceAvailable: z.boolean(),
          stripeRefundAmountMinor: nonnegativeIntegerSchema.nullable(),
        })
      ),
      needsAttention: nonnegativeIntegerSchema,
      pendingRefundReversals: nonnegativeIntegerSchema,
      prepared: nonnegativeIntegerSchema,
      refundLedger: z.object({
        available: z.boolean(),
        checked: nonnegativeIntegerSchema,
        mismatches: nonnegativeIntegerSchema,
        truncated: z.boolean(),
      }),
      refunds: nonnegativeIntegerSchema,
      succeeded: nonnegativeIntegerSchema,
      tracked: nonnegativeIntegerSchema,
    }),
    impact: z.object({
      activityWindowDays: positiveIntegerSchema,
      frozenByCollectionMode: z.object({
        collect: nonnegativeIntegerSchema,
        disabled: nonnegativeIntegerSchema,
      }),
      frozenByProvider: z.object({
        stripe_tax: nonnegativeIntegerSchema,
        taxrate_io: nonnegativeIntegerSchema,
      }),
      paymentsFinalizing: nonnegativeIntegerSchema,
      preparedCheckouts: nonnegativeIntegerSchema,
    }),
    providers: z.object({
      stripeTax: z
        .object({
          ...providerReadinessShape,
          accountMode: z.enum(["live", "sandbox", "unknown"]),
          activeRegistrationCount: nonnegativeIntegerSchema,
          missingFields: z.array(nonEmptyTextSchema),
        })
        .superRefine(enforceProviderReadiness),
      taxRateIo: z
        .object({
          ...providerReadinessShape,
          manualRefreshConfigured: z.boolean(),
          quota: z
            .object({
              observedAt: nullableTextSchema,
              quota: nonnegativeIntegerSchema,
              remaining: nonnegativeIntegerSchema,
              source: nonEmptyTextSchema,
              usage: nonnegativeIntegerSchema,
              usagePercent: z.number().nonnegative(),
            })
            .nullable(),
        })
        .superRefine(enforceProviderReadiness),
    }),
  }
)

export const TAX_CONTROL_QUERY_KEY = ["tax-control"] as const

const loadTaxControl = ({
  signal,
}: QueryFunctionContext<
  typeof TAX_CONTROL_QUERY_KEY
>): Promise<TaxControlSnapshot> =>
  requestAdminJson({
    path: "/admin/tax-control",
    schema: taxControlSnapshotSchema,
    signal,
    timeoutMs: 20_000,
  })

export const taxControlQueryOptions = () =>
  queryOptions({
    queryFn: loadTaxControl,
    queryKey: TAX_CONTROL_QUERY_KEY,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  })

export const transitionTaxControl = (
  input: TaxControlTransitionInput
): Promise<TaxControlSnapshot> =>
  requestAdminJson({
    body: input,
    method: "POST",
    path: "/admin/tax-control/switch",
    schema: taxControlSnapshotSchema,
    timeoutMs: 20_000,
  })

export const refreshTaxRateIoQuota = (): Promise<TaxControlSnapshot> =>
  requestAdminJson({
    method: "POST",
    path: "/admin/tax-control/taxrate-io/refresh",
    schema: taxControlSnapshotSchema,
    timeoutMs: 20_000,
  })
