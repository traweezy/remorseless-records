import {
  queryOptions,
  type QueryFunctionContext,
} from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"

const catalogAuthoringKindSchema = z.enum([
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
])

const catalogAuthoringStatusSchema = z.enum([
  "classified",
  "needs_review",
  "conflict",
])

const catalogAuthoringAuditSummarySchema = z.object({
  blockingItemCount: z.number().int().nonnegative(),
  byKind: z.object({
    fixed_bundle: z.number().int().nonnegative(),
    merch: z.number().int().nonnegative(),
    music_release: z.number().int().nonnegative(),
    mystery_bundle: z.number().int().nonnegative(),
  }),
  byStatus: z.object({
    classified: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    needs_review: z.number().int().nonnegative(),
  }),
  issueCounts: z.record(z.string(), z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
})

export const catalogAuthoringAuditPayloadSchema = z.object({
  filteredCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  items: z.array(
    z.object({
      handle: z.string().nullable(),
      id: z.string().min(1),
      issues: z.array(
        z.object({
          code: z.string().min(1),
          message: z.string().min(1),
          severity: z.enum(["info", "warning", "error"]),
        }),
      ),
      kind: catalogAuthoringKindSchema.nullable(),
      signals: z.array(
        z.object({
          kind: catalogAuthoringKindSchema,
          source: z.string().min(1),
          value: z.string(),
        }),
      ),
      status: catalogAuthoringStatusSchema,
      title: z.string().min(1),
    }),
  ),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  summary: catalogAuthoringAuditSummarySchema,
})

export type CatalogAuthoringAuditPayload = z.infer<
  typeof catalogAuthoringAuditPayloadSchema
>

export const catalogAuthoringAuditQueryKey = [
  "catalog",
  "authoring-audit",
  "summary",
] as const

const loadCatalogAuthoringAudit = async ({
  signal,
}: QueryFunctionContext<
  typeof catalogAuthoringAuditQueryKey
>): Promise<CatalogAuthoringAuditPayload> =>
  requestAdminJson({
    path: "/admin/catalog/authoring-audit?limit=1",
    schema: catalogAuthoringAuditPayloadSchema,
    signal,
  })

export const catalogAuthoringAuditQueryOptions = () =>
  queryOptions({
    queryFn: loadCatalogAuthoringAudit,
    queryKey: catalogAuthoringAuditQueryKey,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  })
