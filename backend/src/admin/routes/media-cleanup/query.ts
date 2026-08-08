import { queryOptions } from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"

export const MEDIA_CLEANUP_PAGE_SIZE = 25
export const MEDIA_CLEANUP_QUERY_KEY = ["catalog-media-orphans"] as const

export const mediaAssetSchema = z.object({
  byteSize: z.number().nullable(),
  createdAt: z.string().nullable().optional(),
  id: z.string(),
  lifecycleStatus: z.enum(["active", "quarantined"]),
  mimeType: z.string().nullable(),
  originalFilename: z.string().nullable(),
  purgeEligibleAt: z.string().nullable(),
  quarantinedAt: z.string().nullable(),
  quarantinedBy: z.string().nullable(),
  sourceFileKey: z.string().nullable(),
  sourceUrl: z.string(),
  version: z.number().int().min(1),
})

export const orphanMediaPageSchema = z.object({
  assets: z.array(mediaAssetSchema),
  count: z.number().int().min(0),
  hasMore: z.boolean(),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
})

const lifecycleResponseSchema = z.object({
  asset: mediaAssetSchema,
})

export type MediaAsset = z.infer<typeof mediaAssetSchema>
export type MediaLifecycleStatus = MediaAsset["lifecycleStatus"]
export type OrphanMediaPage = z.infer<typeof orphanMediaPageSchema>

export const emptyMediaPage = (offset = 0): OrphanMediaPage => ({
  assets: [],
  count: 0,
  hasMore: false,
  limit: MEDIA_CLEANUP_PAGE_SIZE,
  offset,
})

type MediaCleanupQueryInput = {
  lifecycleStatus: MediaLifecycleStatus
  offset: number
}

export const mediaCleanupQueryOptions = ({
  lifecycleStatus,
  offset,
}: MediaCleanupQueryInput) =>
  queryOptions({
    queryFn: ({ signal }) =>
      requestAdminJson({
        path: "/admin/catalog/media/orphans",
        query: {
          lifecycleStatus,
          limit: MEDIA_CLEANUP_PAGE_SIZE,
          offset,
        },
        schema: orphanMediaPageSchema,
        signal,
      }),
    queryKey: [
      ...MEDIA_CLEANUP_QUERY_KEY,
      lifecycleStatus,
      MEDIA_CLEANUP_PAGE_SIZE,
      offset,
    ],
    retry: false,
    staleTime: 10_000,
  })

type UpdateMediaLifecycleInput = {
  asset: MediaAsset
  idempotencyKey: string
}

export const updateMediaLifecycle = async ({
  asset,
  idempotencyKey,
}: UpdateMediaLifecycleInput): Promise<"quarantine" | "restore"> => {
  const action =
    asset.lifecycleStatus === "quarantined" ? "restore" : "quarantine"
  await requestAdminJson({
    body: {
      expectedVersion: asset.version,
      idempotencyKey,
    },
    method: "POST",
    path: `/admin/catalog/media/assets/${encodeURIComponent(asset.id)}/${action}`,
    schema: lifecycleResponseSchema,
  })
  return action
}
