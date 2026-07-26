import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  resolveStripeTaxReadiness,
  resolveTaxRateIoReadiness,
} from "../../../lib/tax-control/readiness";
import { TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE } from "../../../lib/constants";
import { syncTaxRateIoQuota } from "../../../lib/tax-control/quota";
import {
  TAX_CONTROL_ID,
  type TaxProviderName,
} from "../../../modules/tax-control/constants";
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

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const dateString = (value: unknown): string | null => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const ensureTaxControl = async (service: TaxControlModuleService) => {
  try {
    return await service.retrieveTaxProviderControl(TAX_CONTROL_ID);
  } catch {
    const [created] = await service.createTaxProviderControls([
      {
        id: TAX_CONTROL_ID,
        active_provider: "taxrate_io",
        generation: 1,
        metadata: {},
      },
    ]);
    if (!created) {
      throw new Error("Tax provider control could not be initialized.");
    }
    return created;
  }
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

const evidenceSnapshot = async (service: TaxControlModuleService) => {
  const [
    [, tracked],
    [, prepared],
    [, succeeded],
    [, refunds],
    [, needsAttention],
    incidents,
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
  ]);

  return {
    incidents: incidents.map((evidence) => ({
      associationStatus: evidence.association_status,
      id: evidence.id,
      lastVerifiedAt: dateString(evidence.last_verified_at),
      orderId: evidence.order_id,
      paymentIntentId: evidence.payment_intent_id,
      provider: evidence.provider,
      status: evidence.status,
    })),
    needsAttention,
    prepared,
    refunds,
    succeeded,
    tracked,
  };
};

export const taxControlSnapshot = async (container: MedusaContainer) => {
  const service = container.resolve<TaxControlModuleService>("tax_control");
  const logger = container.resolve<Logger>("logger");
  const [control, quota, stripe, audits, impact, evidence] = await Promise.all([
    ensureTaxControl(service),
    syncTaxRateIoQuota({ logger, service }),
    resolveStripeTaxReadiness(),
    service.listTaxProviderAudits(
      {},
      { order: { created_at: "DESC" }, take: 25 },
    ),
    impactSnapshot(container),
    evidenceSnapshot(service),
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
