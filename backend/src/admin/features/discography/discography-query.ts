import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"

export const discographyAvailabilityValues = [
  "in_print",
  "out_of_print",
  "preorder",
  "digital_only",
  "unknown",
] as const

export const discographySourceModeValues = [
  "catalog_product",
  "manual",
] as const

export const discographyEntrySchema = z.object({
  album: z.string(),
  archivedAt: z.string().nullable(),
  artist: z.string(),
  availability: z.enum(discographyAvailabilityValues),
  catalogNumber: z.string().nullable(),
  collectionTitle: z.string().nullable(),
  coverAltText: z.string().nullable(),
  coverUrl: z.string().nullable(),
  createdAt: z.string().nullable().optional(),
  formats: z.array(z.string()),
  genres: z.array(z.string()),
  id: z.string(),
  lastSyncedAt: z.string().nullable(),
  linkHealth: z.enum([
    "healthy",
    "missing",
    "not_applicable",
    "unknown",
    "unpublished",
  ]),
  productHandle: z.string().nullable(),
  productId: z.string().nullable(),
  releaseDate: z.string().nullable(),
  releaseYear: z.number().int().nullable(),
  sourceMode: z.enum(discographySourceModeValues),
  tags: z.array(z.string()),
  title: z.string(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().min(1),
})

export const discographyPageSchema = z.object({
  count: z.number().int().min(0),
  entries: z.array(discographyEntrySchema),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
})

const discographyMutationSchema = z.object({
  entry: discographyEntrySchema,
  replayed: z.boolean(),
})

export type DiscographyAvailability =
  (typeof discographyAvailabilityValues)[number]
export type DiscographySourceMode = (typeof discographySourceModeValues)[number]
export type DiscographyEntry = z.infer<typeof discographyEntrySchema>
export type DiscographyPage = z.infer<typeof discographyPageSchema>

export type DiscographyListInput = {
  archived: "active" | "archived"
  availability: DiscographyAvailability | "all"
  direction: "asc" | "desc"
  limit: number
  offset: number
  order:
    | "artist"
    | "created_at"
    | "release_date"
    | "release_year"
    | "title"
    | "updated_at"
  q: string
  sourceMode: DiscographySourceMode | "all"
}

export type ManualDiscographyInput = {
  artist: string
  availability: DiscographyAvailability
  catalogNumber: string | null
  collectionTitle: string | null
  coverAltText: string | null
  coverUrl: string | null
  formats: string[]
  genres: string[]
  releaseDate: string | null
  releaseTitle: string
  releaseYear: number | null
  tags: string[]
}

export const listDiscographyEntries = (
  input: DiscographyListInput,
  signal?: AbortSignal
): Promise<DiscographyPage> =>
  requestAdminJson({
    path: "/admin/discography",
    query: {
      archived: input.archived,
      ...(input.availability === "all"
        ? {}
        : { availability: input.availability }),
      direction: input.direction,
      limit: input.limit,
      offset: input.offset,
      order: input.order,
      ...(input.q.trim() ? { q: input.q.trim() } : {}),
      ...(input.sourceMode === "all" ? {} : { sourceMode: input.sourceMode }),
    },
    schema: discographyPageSchema,
    ...(signal ? { signal } : {}),
  })

export const createManualDiscographyEntry = (
  input: ManualDiscographyInput,
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      ...input,
      expectedVersion: 0,
      idempotencyKey,
    },
    method: "POST",
    path: "/admin/discography",
    schema: discographyMutationSchema,
  })

export const updateManualDiscographyEntry = (
  entry: DiscographyEntry,
  input: ManualDiscographyInput,
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      ...input,
      expectedVersion: entry.version,
      idempotencyKey,
    },
    method: "PUT",
    path: `/admin/discography/${encodeURIComponent(entry.id)}`,
    schema: discographyMutationSchema,
  })

export const updateDiscographyLifecycle = (
  entry: DiscographyEntry,
  action: "archive" | "restore",
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      expectedVersion: entry.version,
      idempotencyKey,
    },
    method: "POST",
    path: `/admin/discography/${encodeURIComponent(entry.id)}/${action}`,
    schema: discographyMutationSchema,
  })
