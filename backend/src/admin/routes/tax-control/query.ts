import {
  queryOptions,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import { z } from "zod";

import { requestAdminJson } from "../../lib/admin-request";
import { providerNames, type ProviderName } from "./ui-state";

export type ReadinessCheck = {
  detail: string;
  id: string;
  label: string;
  ready: boolean;
};

export type ProviderReadiness = {
  checks: ReadinessCheck[];
  configured: boolean;
  message: string;
  ready: boolean;
};

export type TaxControlSnapshot = {
  audits: Array<{
    actorId: string;
    createdAt: string | null;
    fromGeneration: number;
    fromProvider: ProviderName;
    id: string;
    reason: string;
    toGeneration: number;
    toProvider: ProviderName;
  }>;
  control: {
    activeProvider: ProviderName;
    generation: number;
    lastSwitchReason: string | null;
    lastSwitchedAt: string | null;
    lastSwitchedBy: string | null;
  };
  evidence: {
    incidents: Array<{
      associationStatus: string | null;
      currencyCode: string;
      id: string;
      lastVerifiedAt: string | null;
      medusaRefundAmountMinor: number | null;
      orderId: string | null;
      paymentIntentId: string;
      provider: ProviderName;
      status:
        | "association_failed"
        | "disputed"
        | "refund_ledger_mismatch"
        | "refund_pending";
      stripeEvidenceAvailable: boolean;
      stripeRefundAmountMinor: number | null;
    }>;
    needsAttention: number;
    pendingRefundReversals: number;
    prepared: number;
    refundLedger: {
      available: boolean;
      checked: number;
      mismatches: number;
      truncated: boolean;
    };
    refunds: number;
    succeeded: number;
    tracked: number;
  };
  impact: {
    activityWindowDays: number;
    frozenByProvider: Record<ProviderName, number>;
    paymentsFinalizing: number;
    preparedCheckouts: number;
  };
  providers: {
    stripeTax: ProviderReadiness & {
      accountMode: "live" | "sandbox" | "unknown";
      activeRegistrationCount: number;
      missingFields: string[];
    };
    taxRateIo: ProviderReadiness & {
      manualRefreshConfigured: boolean;
      quota: {
        observedAt: string | null;
        quota: number;
        remaining: number;
        source: string;
        usage: number;
        usagePercent: number;
      } | null;
    };
  };
};

export type SwitchTaxProviderInput = {
  expectedGeneration: number;
  idempotencyKey: string;
  reason: string;
  targetProvider: ProviderName;
};

const nonEmptyTextSchema = z.string().min(1);
const nullableTextSchema = nonEmptyTextSchema.nullable();
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const providerNameSchema = z.enum(providerNames);

const readinessCheckSchema: z.ZodType<ReadinessCheck> = z.object({
  detail: nonEmptyTextSchema,
  id: nonEmptyTextSchema,
  label: nonEmptyTextSchema,
  ready: z.boolean(),
});

const providerReadinessSchema = z.object({
  checks: z.array(readinessCheckSchema),
  configured: z.boolean(),
  message: nonEmptyTextSchema,
  ready: z.boolean(),
});

export const taxControlSnapshotSchema: z.ZodType<TaxControlSnapshot> = z.object({
  audits: z.array(
    z.object({
      actorId: nonEmptyTextSchema,
      createdAt: nullableTextSchema,
      fromGeneration: positiveIntegerSchema,
      fromProvider: providerNameSchema,
      id: nonEmptyTextSchema,
      reason: nonEmptyTextSchema,
      toGeneration: positiveIntegerSchema,
      toProvider: providerNameSchema,
    }),
  ),
  control: z.object({
    activeProvider: providerNameSchema,
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
        provider: providerNameSchema,
        status: z.enum([
          "association_failed",
          "disputed",
          "refund_ledger_mismatch",
          "refund_pending",
        ]),
        stripeEvidenceAvailable: z.boolean(),
        stripeRefundAmountMinor: nonnegativeIntegerSchema.nullable(),
      }),
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
    frozenByProvider: z.object({
      stripe_tax: nonnegativeIntegerSchema,
      taxrate_io: nonnegativeIntegerSchema,
    }),
    paymentsFinalizing: nonnegativeIntegerSchema,
    preparedCheckouts: nonnegativeIntegerSchema,
  }),
  providers: z.object({
    stripeTax: providerReadinessSchema.extend({
      accountMode: z.enum(["live", "sandbox", "unknown"]),
      activeRegistrationCount: nonnegativeIntegerSchema,
      missingFields: z.array(nonEmptyTextSchema),
    }),
    taxRateIo: providerReadinessSchema.extend({
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
    }),
  }),
});

export const TAX_CONTROL_QUERY_KEY = ["tax-control"] as const;

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
  });

export const taxControlQueryOptions = () =>
  queryOptions({
    queryFn: loadTaxControl,
    queryKey: TAX_CONTROL_QUERY_KEY,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });

export const switchTaxProvider = (
  input: SwitchTaxProviderInput,
): Promise<TaxControlSnapshot> =>
  requestAdminJson({
    body: input,
    method: "POST",
    path: "/admin/tax-control/switch",
    schema: taxControlSnapshotSchema,
    timeoutMs: 20_000,
  });

export const refreshTaxRateIoQuota =
  (): Promise<TaxControlSnapshot> =>
    requestAdminJson({
      method: "POST",
      path: "/admin/tax-control/taxrate-io/refresh",
      schema: taxControlSnapshotSchema,
      timeoutMs: 20_000,
    });
