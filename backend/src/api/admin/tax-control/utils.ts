import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  resolveStripeTaxReadiness,
  resolveTaxRateIoReadiness,
} from "../../../lib/tax-control/readiness";
import {
  buildRefundLedgerMismatches,
  type RefundEvidenceRecord,
} from "../../../lib/tax-control/refund-ledger";
import { TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE } from "../../../lib/constants";
import { syncTaxRateIoQuota } from "../../../lib/tax-control/quota";
import type { TaxProviderName } from "../../../modules/tax-control/constants";
import type TaxControlModuleService from "../../../modules/tax-control/service";

type UnknownRecord = Record<string, unknown>;

type QueryGraph = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: {
      order?: Record<string, "ASC" | "DESC">;
      take?: number;
    };
  }) => Promise<{ data: UnknownRecord[] }>;
};

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
const ACTIVE_CART_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const IMPACT_QUERY_LIMIT = 500;
const REFUND_LEDGER_QUERY_LIMIT = 500;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const dateString = (value: unknown): string | null => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const impactSnapshot = async (container: MedusaContainer) => {
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY);
  const activeSince = new Date(
    Date.now() - ACTIVE_CART_WINDOW_MS,
  ).toISOString();
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
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
      take: IMPACT_QUERY_LIMIT,
    },
  });

  let preparedCarts = 0;
  let finalizingCarts = 0;
  const frozenByProvider: Record<TaxProviderName, number> = {
    stripe_tax: 0,
    taxrate_io: 0,
  };
  for (const cart of data) {
    const collection = asRecord(cart.payment_collection);
    const sessions = Array.isArray(collection?.payment_sessions)
      ? collection.payment_sessions
      : [];
    let prepared = false;
    let finalizing = false;
    let frozenProvider: TaxProviderName | null = null;
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
      if (provider === "stripe_tax" || provider === "taxrate_io") {
        frozenProvider = provider;
      }
    }
    if (prepared) {
      preparedCarts += 1;
    }
    if (finalizing) {
      finalizingCarts += 1;
    }
    if (prepared && frozenProvider) {
      frozenByProvider[frozenProvider] += 1;
    }
  }

  return {
    activeCartWindowDays: ACTIVE_CART_WINDOW_MS / (24 * 60 * 60 * 1000),
    activeCarts: data.length,
    finalizingCarts,
    frozenByProvider,
    preparedCarts,
    truncated: data.length === IMPACT_QUERY_LIMIT,
  };
};

const evidenceSnapshot = async ({
  container,
  logger,
  service,
}: {
  container: MedusaContainer;
  logger: Logger;
  service: TaxControlModuleService;
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
      { take: 1 },
    ),
    service.listAndCountTaxQuoteEvidences(
      { status: ["association_failed", "disputed"] },
      { take: 1 },
    ),
    service.listTaxQuoteEvidences(
      { status: ["association_failed", "disputed"] },
      { order: { last_verified_at: "DESC" }, take: 25 },
    ),
    service.listAndCountTaxQuoteEvidences(
      { association_status: "refund_pending" },
      { order: { last_verified_at: "DESC" }, take: 25 },
    ),
    service.listTaxQuoteEvidences(
      {},
      {
        order: { last_verified_at: "DESC" },
        take: REFUND_LEDGER_QUERY_LIMIT,
      },
    ),
  ]);

  let refundLedgerAvailable = true;
  let refundLedgerMismatches: ReturnType<typeof buildRefundLedgerMismatches> =
    [];
  const orderIds = Array.from(
    new Set(
      refundEvidence
        .map((evidence) => text(evidence.order_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const cartIds = Array.from(
    new Set(
      refundEvidence
        .filter((evidence) => !text(evidence.order_id))
        .map((evidence) => text(evidence.cart_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (orderIds.length || cartIds.length) {
    try {
      const query = container.resolve<QueryGraph>(
        ContainerRegistrationKeys.QUERY,
      );
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
      ]);
      refundLedgerMismatches = buildRefundLedgerMismatches({
        evidence: refundEvidence as RefundEvidenceRecord[],
        paymentRecords: [...orders.data, ...carts.data],
      });
    } catch (caught) {
      refundLedgerAvailable = false;
      logger.warn(
        `[tax-control] refund ledger comparison unavailable: ${
          caught instanceof Error ? caught.message : "unknown query error"
        }`,
      );
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
  }));

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
        (right.lastVerifiedAt ?? "").localeCompare(left.lastVerifiedAt ?? ""),
      )
      .slice(0, 25),
    needsAttention:
      needsAttention +
      refundLedgerMismatches.filter(
        (mismatch) =>
          mismatch.evidence.status !== "association_failed" &&
          mismatch.evidence.status !== "disputed",
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
  };
};

export const taxControlSnapshot = async (container: MedusaContainer) => {
  const service = container.resolve<TaxControlModuleService>("tax_control");
  const logger = container.resolve<Logger>("logger");
  const [control, quota, stripe, audits, impact, evidence] = await Promise.all([
    service.ensureTaxProviderControl(),
    syncTaxRateIoQuota({ logger, service }),
    resolveStripeTaxReadiness(),
    service.listTaxProviderAudits(
      {},
      { order: { created_at: "DESC" }, take: 25 },
    ),
    impactSnapshot(container),
    evidenceSnapshot({ container, logger, service }),
  ]);
  const remaining = quota ? Number(quota.remaining) : null;

  return {
    audits: audits.map((audit) => ({
      actorId: audit.actor_id,
      createdAt: dateString(audit.created_at),
      fromGeneration: audit.from_generation,
      fromProvider: audit.from_provider,
      id: audit.id,
      reason: audit.reason,
      toGeneration: audit.to_generation,
      toProvider: audit.to_provider,
    })),
    control: {
      activeProvider: control.active_provider,
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
          TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE?.trim(),
        ),
        quota: quota
          ? {
              observedAt: dateString(quota.observed_at),
              quota: Number(quota.quota),
              remaining: Number(quota.remaining),
              source: quota.source,
              usage: Number(quota.usage),
              usagePercent: Number(quota.usage_percent),
            }
          : null,
      },
    },
  };
};
