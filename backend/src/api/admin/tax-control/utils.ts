import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  resolveStripeTaxReadiness,
  resolveTaxRateIoReadiness,
} from "../../../lib/tax-control/readiness"
import {
  buildRefundLedgerMismatches,
  type RefundEvidenceRecord,
} from "../../../lib/tax-control/refund-ledger"
import {
  loadTaxControlImpact,
  type TaxControlImpactQuery,
} from "../../../lib/tax-control/impact"
import { TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE } from "../../../lib/constants"
import { syncTaxRateIoQuota } from "../../../lib/tax-control/quota"
import type TaxControlModuleService from "../../../modules/tax-control/service"

type UnknownRecord = Record<string, unknown>

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      order?: Record<string, "ASC" | "DESC">
      take?: number
    }
  }) => Promise<{ data: UnknownRecord[] }>
}

const REFUND_LEDGER_QUERY_LIMIT = 500

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const dateString = (value: unknown): string | null => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const evidenceSnapshot = async ({
  container,
  logger,
  service,
}: {
  container: MedusaContainer
  logger: Logger
  service: TaxControlModuleService
}) => {
  const [
    [, tracked],
    [, prepared],
    [, succeeded],
    [, refunds],
    [, needsAttention],
    incidents,
    [pendingRefundIncidents, pendingRefundReversals],
    refundEvidence,
  ] = await Promise.all([
    service.listAndCountTaxQuoteEvidences({}, { take: 1 }),
    service.listAndCountTaxQuoteEvidences({ status: "prepared" }, { take: 1 }),
    service.listAndCountTaxQuoteEvidences({ status: "succeeded" }, { take: 1 }),
    service.listAndCountTaxQuoteEvidences(
      { status: ["partially_refunded", "refunded"] },
      { take: 1 }
    ),
    service.listAndCountTaxQuoteEvidences(
      { status: ["association_failed", "disputed"] },
      { take: 1 }
    ),
    service.listTaxQuoteEvidences(
      { status: ["association_failed", "disputed"] },
      { order: { last_verified_at: "DESC" }, take: 25 }
    ),
    service.listAndCountTaxQuoteEvidences(
      { association_status: "refund_pending" },
      { order: { last_verified_at: "DESC" }, take: 25 }
    ),
    service.listTaxQuoteEvidences(
      {},
      {
        order: { last_verified_at: "DESC" },
        take: REFUND_LEDGER_QUERY_LIMIT,
      }
    ),
  ])

  let refundLedgerAvailable = true
  let refundLedgerMismatches: ReturnType<typeof buildRefundLedgerMismatches> =
    []
  const orderIds = Array.from(
    new Set(
      refundEvidence
        .map((evidence) => text(evidence.order_id))
        .filter((id): id is string => Boolean(id))
    )
  )
  const cartIds = Array.from(
    new Set(
      refundEvidence
        .filter((evidence) => !text(evidence.order_id))
        .map((evidence) => text(evidence.cart_id))
        .filter((id): id is string => Boolean(id))
    )
  )
  if (orderIds.length || cartIds.length) {
    try {
      const query = container.resolve<QueryGraph>(
        ContainerRegistrationKeys.QUERY
      )
      const [orders, carts] = await Promise.all([
        orderIds.length
          ? query.graph({
              entity: "order",
              fields: [
                "id",
                "payment_collections.payments.provider_id",
                "payment_collections.payments.data",
                "payment_collections.payments.refunds.amount",
              ],
              filters: { id: orderIds },
              pagination: { take: orderIds.length },
            })
          : Promise.resolve({ data: [] }),
        cartIds.length
          ? query.graph({
              entity: "cart",
              fields: [
                "id",
                "payment_collection.payments.provider_id",
                "payment_collection.payments.data",
                "payment_collection.payments.refunds.amount",
              ],
              filters: { id: cartIds },
              pagination: { take: cartIds.length },
            })
          : Promise.resolve({ data: [] }),
      ])
      refundLedgerMismatches = buildRefundLedgerMismatches({
        evidence: refundEvidence as RefundEvidenceRecord[],
        paymentRecords: [...orders.data, ...carts.data],
      })
    } catch (caught) {
      refundLedgerAvailable = false
      logger.warn(
        `[tax-control] refund ledger comparison unavailable: ${
          caught instanceof Error ? caught.message : "unknown query error"
        }`
      )
    }
  }

  const ledgerIncidents = refundLedgerMismatches.map((mismatch) => ({
    associationStatus: mismatch.evidence.association_status,
    currencyCode: mismatch.evidence.currency_code,
    id: `${mismatch.evidence.id}:refund-ledger`,
    lastVerifiedAt: dateString(mismatch.evidence.last_verified_at),
    medusaRefundAmountMinor: mismatch.medusaRefundAmountMinor,
    orderId: mismatch.evidence.order_id,
    paymentIntentId: mismatch.evidence.payment_intent_id,
    provider: mismatch.evidence.provider,
    status: "refund_ledger_mismatch" as const,
    stripeEvidenceAvailable: mismatch.stripeEvidenceAvailable,
    stripeRefundAmountMinor: mismatch.stripeRefundAmountMinor,
  }))

  return {
    incidents: [
      ...incidents.map((evidence) => ({
        associationStatus: evidence.association_status,
        currencyCode: evidence.currency_code,
        id: evidence.id,
        lastVerifiedAt: dateString(evidence.last_verified_at),
        medusaRefundAmountMinor: null,
        orderId: evidence.order_id,
        paymentIntentId: evidence.payment_intent_id,
        provider: evidence.provider,
        status: evidence.status,
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: null,
      })),
      ...pendingRefundIncidents.map((evidence) => ({
        associationStatus: evidence.association_status,
        currencyCode: evidence.currency_code,
        id: evidence.id,
        lastVerifiedAt: dateString(evidence.last_verified_at),
        medusaRefundAmountMinor: null,
        orderId: evidence.order_id,
        paymentIntentId: evidence.payment_intent_id,
        provider: evidence.provider,
        status: "refund_pending" as const,
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: null,
      })),
      ...ledgerIncidents,
    ]
      .sort((left, right) =>
        (right.lastVerifiedAt ?? "").localeCompare(left.lastVerifiedAt ?? "")
      )
      .slice(0, 25),
    needsAttention:
      needsAttention +
      refundLedgerMismatches.filter(
        (mismatch) =>
          mismatch.evidence.status !== "association_failed" &&
          mismatch.evidence.status !== "disputed"
      ).length,
    pendingRefundReversals,
    prepared,
    refunds,
    succeeded,
    tracked,
    refundLedger: {
      available: refundLedgerAvailable,
      checked: refundEvidence.length,
      mismatches: refundLedgerMismatches.length,
      truncated: tracked > REFUND_LEDGER_QUERY_LIMIT,
    },
  }
}

export const taxControlSnapshot = async (container: MedusaContainer) => {
  const service = container.resolve<TaxControlModuleService>("tax_control")
  const logger = container.resolve<Logger>("logger")
  const [control, quota, stripe, audits, impact, evidence] = await Promise.all([
    service.ensureTaxProviderControl(),
    syncTaxRateIoQuota({ logger, service }),
    resolveStripeTaxReadiness({ logger }),
    service.listTaxProviderAudits(
      {},
      { order: { created_at: "DESC" }, take: 25 }
    ),
    loadTaxControlImpact(
      container.resolve<TaxControlImpactQuery>(ContainerRegistrationKeys.QUERY)
    ),
    evidenceSnapshot({ container, logger, service }),
  ])
  const remaining = quota?.remaining ?? null

  return {
    audits: audits.map((audit) => ({
      actorId: audit.actor_id,
      acknowledgementVersion: audit.acknowledgement_version,
      createdAt: dateString(audit.created_at),
      fromCollectionMode: audit.from_collection_mode,
      fromGeneration: audit.from_generation,
      fromProvider: audit.from_provider,
      id: audit.id,
      reason: audit.reason,
      toCollectionMode: audit.to_collection_mode,
      toGeneration: audit.to_generation,
      toProvider: audit.to_provider,
    })),
    control: {
      activeProvider: control.active_provider,
      collectionMode: control.collection_mode,
      generation: control.generation,
      lastSwitchReason: control.last_switch_reason,
      lastSwitchedAt: dateString(control.updated_at),
      lastSwitchedBy: control.last_switched_by,
    },
    evidence,
    impact,
    providers: {
      stripeTax: stripe,
      taxRateIo: {
        ...resolveTaxRateIoReadiness(remaining),
        manualRefreshConfigured: Boolean(
          TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE?.trim()
        ),
        quota: quota
          ? {
              observedAt: quota.observedAt,
              quota: quota.quota,
              remaining: quota.remaining,
              source: quota.source,
              usage: quota.usage,
              usagePercent: quota.usagePercent,
            }
          : null,
      },
    },
  }
}
