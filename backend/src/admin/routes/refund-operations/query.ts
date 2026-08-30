import { queryOptions, type QueryFunctionContext } from "@tanstack/react-query"
import { z } from "zod"

import type { RefundOperationsSnapshot } from "../../../lib/refund-operations/types"
import { requestAdminJson } from "../../lib/admin-request"

const refundCaseStatusSchema = z.enum([
  "action_required",
  "processing",
  "verified",
])

const refundProviderSchema = z.enum(["stripe_tax", "taxrate_io", "untracked"])

const refundTaxStatusSchema = z.enum([
  "attention",
  "not_applicable",
  "pending",
  "untracked",
  "verified",
])

const stripeRefundStatusSchema = z.enum([
  "canceled",
  "failed",
  "pending",
  "requires_action",
  "succeeded",
  "unknown",
])

export const refundOperationsSnapshotSchema: z.ZodType<RefundOperationsSnapshot> =
  z.object({
    cases: z.array(
      z.object({
        caseId: z.string().min(1),
        currencyCode: z.string().regex(/^[a-z]{3}$/),
        displayId: z.number().int().nonnegative().nullable(),
        latestRefundAt: z.string().min(1).nullable(),
        lastVerifiedAt: z.string().min(1).nullable(),
        medusaRefundAmountMinor: z.number().int().nonnegative(),
        medusaRefundCount: z.number().int().nonnegative(),
        nextAction: z.string().min(1),
        orderId: z.string().min(1).nullable(),
        provider: refundProviderSchema,
        reasonLabels: z.array(z.string().min(1)),
        status: refundCaseStatusSchema,
        stripeRefundAmountMinor: z.number().int().nonnegative().nullable(),
        stripeRefundCount: z.number().int().nonnegative().nullable(),
        stripeStatuses: z.array(stripeRefundStatusSchema),
        taxStatus: refundTaxStatusSchema,
      })
    ),
    generatedAt: z.string().min(1),
    reasonConfiguration: z.object({
      configured: z.boolean(),
      count: z.number().int().nonnegative(),
    }),
    source: z.object({
      evidenceScanned: z.number().int().nonnegative(),
      ordersScanned: z.number().int().nonnegative(),
      truncated: z.boolean(),
      windowDays: z.number().int().positive(),
    }),
    summary: z.object({
      actionRequired: z.number().int().nonnegative(),
      amountsByCurrency: z.array(
        z.object({
          amountMinor: z.number().int().nonnegative(),
          currencyCode: z.string().regex(/^[a-z]{3}$/),
        })
      ),
      processing: z.number().int().nonnegative(),
      totalCases: z.number().int().nonnegative(),
      verified: z.number().int().nonnegative(),
    }),
  })

export const REFUND_OPERATIONS_QUERY_KEY = ["refund-operations"] as const

const loadRefundOperations = ({
  signal,
}: QueryFunctionContext<
  typeof REFUND_OPERATIONS_QUERY_KEY
>): Promise<RefundOperationsSnapshot> =>
  requestAdminJson({
    path: "/admin/refund-operations",
    schema: refundOperationsSnapshotSchema,
    signal,
  })

export const refundOperationsQueryOptions = () =>
  queryOptions({
    queryFn: loadRefundOperations,
    queryKey: REFUND_OPERATIONS_QUERY_KEY,
    retry: false,
    staleTime: 0,
  })
