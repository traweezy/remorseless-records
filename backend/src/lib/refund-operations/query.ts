import type {
  IPaymentModuleService,
  MedusaContainer,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

import type TaxControlModuleService from "../../modules/tax-control/service";
import { projectRefundCases, summarizeRefundCases } from "./projection";
import type { RefundOperationsSnapshot } from "./types";

type UnknownRecord = Record<string, unknown>;

type QueryGraph = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: {
      order?: Record<string, "ASC" | "DESC">;
      skip?: number;
      take?: number;
    };
  }) => Promise<{ data: UnknownRecord[] }>;
};

const PAGE_SIZE = 250;
const ID_BATCH_SIZE = 250;
const MAX_EVIDENCE = 50_000;
const MAX_RECENT_ORDERS = 50_000;
export const REFUND_ACTIVITY_WINDOW_DAYS = 180;
const REFUND_EVIDENCE_STATUSES = [
  "association_failed",
  "disputed",
  "partially_refunded",
  "refunded",
] as const;

const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "payment_collections.payments.id",
  "payment_collections.payments.currency_code",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  "payment_collections.payments.refunds.id",
  "payment_collections.payments.refunds.amount",
  "payment_collections.payments.refunds.raw_amount",
  "payment_collections.payments.refunds.created_at",
  "payment_collections.payments.refunds.refund_reason_id",
  "payment_collections.payments.refunds.refund_reason.label",
  "payment_collections.payments.refunds.refund_reason.code",
] as const;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const integer = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const records = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((record): record is UnknownRecord => record !== null)
    : [];

const hasMedusaRefund = (order: UnknownRecord): boolean =>
  records(order.payment_collections).some((collection) =>
    records(collection.payments).some(
      (payment) => records(payment.refunds).length > 0,
    ),
  );

const hasRefundSignal = (value: unknown): boolean => {
  const evidence = asRecord(value);
  const metadata = asRecord(evidence?.metadata);
  const association = text(evidence?.association_status)?.toLowerCase() ?? "";
  const status = text(evidence?.status);
  return (
    (integer(metadata?.refund_amount_minor) ?? 0) > 0 ||
    (integer(metadata?.stripe_refund_count) ?? 0) > 0 ||
    association.includes("refund_") ||
    status === "partially_refunded" ||
    status === "refunded" ||
    status === "disputed"
  );
};

const loadEvidence = async (
  service: TaxControlModuleService,
): Promise<{ evidence: unknown[]; truncated: boolean }> => {
  const evidence: unknown[] = [];
  while (evidence.length < MAX_EVIDENCE) {
    const [page, count] = await service.listAndCountTaxQuoteEvidences(
      { status: [...REFUND_EVIDENCE_STATUSES] },
      {
        order: { last_verified_at: "DESC" },
        skip: evidence.length,
        take: Math.min(PAGE_SIZE, MAX_EVIDENCE - evidence.length),
      },
    );
    evidence.push(...page);
    if (evidence.length >= count || page.length < PAGE_SIZE) {
      return { evidence, truncated: false };
    }
  }
  return { evidence, truncated: true };
};

const activityCutoff = (now: Date): string =>
  new Date(
    now.getTime() - REFUND_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();

const loadRecentOrders = async ({
  now,
  query,
}: {
  now: Date;
  query: QueryGraph;
}): Promise<{ orders: UnknownRecord[]; truncated: boolean }> => {
  const orders: UnknownRecord[] = [];
  let scanned = 0;
  while (scanned < MAX_RECENT_ORDERS) {
    const { data } = await query.graph({
      entity: "order",
      fields: [...ORDER_FIELDS],
      filters: {
        updated_at: { $gte: activityCutoff(now) },
      },
      pagination: {
        order: { updated_at: "DESC" },
        skip: scanned,
        take: Math.min(PAGE_SIZE, MAX_RECENT_ORDERS - scanned),
      },
    });
    scanned += data.length;
    orders.push(...data.filter(hasMedusaRefund));
    if (data.length < PAGE_SIZE) {
      return { orders, truncated: false };
    }
  }
  return { orders, truncated: true };
};

const chunks = <T,>(values: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );

const loadEvidenceOrders = async ({
  evidence,
  loadedOrderIds,
  query,
}: {
  evidence: unknown[];
  loadedOrderIds: Set<string>;
  query: QueryGraph;
}): Promise<UnknownRecord[]> => {
  const orderIds = [
    ...new Set(
      evidence
        .filter(hasRefundSignal)
        .map((value) => text(asRecord(value)?.order_id))
        .filter(
          (id): id is string =>
            id !== null && !loadedOrderIds.has(id),
        ),
    ),
  ];
  const loaded: UnknownRecord[] = [];
  for (const batch of chunks(orderIds, ID_BATCH_SIZE)) {
    const { data } = await query.graph({
      entity: "order",
      fields: [...ORDER_FIELDS],
      filters: { id: batch },
      pagination: { take: batch.length },
    });
    loaded.push(...data);
  }
  return loaded;
};

export const buildRefundOperationsSnapshot = async ({
  container,
  now = new Date(),
}: {
  container: MedusaContainer;
  now?: Date;
}): Promise<RefundOperationsSnapshot> => {
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY);
  const taxControl =
    container.resolve<TaxControlModuleService>("tax_control");
  const payment =
    container.resolve<IPaymentModuleService>(Modules.PAYMENT);

  const [loadedEvidence, recentOrders, refundReasons] = await Promise.all([
    loadEvidence(taxControl),
    loadRecentOrders({ now, query }),
    payment.listRefundReasons({}),
  ]);
  const recentOrderIds = new Set(
    recentOrders.orders
      .map((order) => text(order.id))
      .filter((id): id is string => Boolean(id)),
  );
  const evidenceOrders = await loadEvidenceOrders({
    evidence: loadedEvidence.evidence,
    loadedOrderIds: recentOrderIds,
    query,
  });
  const orders = [...recentOrders.orders, ...evidenceOrders];
  const cases = projectRefundCases({
    evidence: loadedEvidence.evidence,
    orders,
  });

  return {
    cases,
    generatedAt: now.toISOString(),
    reasonConfiguration: {
      configured: refundReasons.length > 0,
      count: refundReasons.length,
    },
    source: {
      evidenceScanned: loadedEvidence.evidence.length,
      ordersScanned: orders.length,
      truncated: loadedEvidence.truncated || recentOrders.truncated,
      windowDays: REFUND_ACTIVITY_WINDOW_DAYS,
    },
    summary: summarizeRefundCases(cases),
  };
};
