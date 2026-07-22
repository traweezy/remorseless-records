import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { z } from "zod"

import {
  isNewReleaseCandidate,
  resolveShelfProductIds,
} from "@/lib/catalog/shelves"
import type CatalogModuleService from "@/modules/catalog/service"
import {
  type CatalogProductProfileRecord,
  type CatalogShelfProductRecord,
  type CatalogShelfRecord,
  serializeCatalogShelf,
} from "@/modules/catalog/serializers"

type CatalogService = InstanceType<typeof CatalogModuleService>
type QueryGraph = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { take?: number; skip?: number }
  }) => Promise<{ data: Array<Record<string, unknown>> }>
}

const listQuerySchema = z.object({
  handles: z
    .string()
    .trim()
    .max(500)
    .transform((value) =>
      Array.from(
        new Set(
          value
            .split(",")
            .map((handle) => handle.trim())
            .filter(Boolean)
        )
      ).slice(0, 20)
    )
    .optional(),
})

const toTimestamp = (value: unknown): number => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime()
  }
  if (typeof value !== "string") {
    return 0
  }
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const toString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const { handles } = listQuerySchema.parse(req.query)
  const now = new Date()
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const shelfFilters: Record<string, unknown> = { is_active: true }
  if (handles?.length) {
    shelfFilters.handle = handles
  }

  const [shelves] = (await catalogService.listAndCountCatalogShelfs(
    shelfFilters,
    {
      take: 50,
      order: { ribbon_priority: "ASC", created_at: "ASC" },
    }
  )) as [CatalogShelfRecord[], number]
  const activeShelves = shelves.filter((shelf) => {
    const startsAt = toTimestamp(shelf.starts_at)
    const endsAt = toTimestamp(shelf.ends_at)
    return (!startsAt || startsAt <= now.getTime()) &&
      (!endsAt || endsAt > now.getTime())
  })
  const shelfIds = activeShelves.map((shelf) => shelf.id)

  const [memberships, profiles] = await Promise.all([
    shelfIds.length
      ? catalogService.listCatalogShelfProducts(
          { shelf_id: shelfIds },
          { take: 2_500, order: { sort_order: "ASC" } }
        ) as Promise<CatalogShelfProductRecord[]>
      : Promise.resolve([]),
    activeShelves.some(
      (shelf) =>
        (shelf.mode === "automatic" || shelf.mode === "hybrid") &&
        shelf.automation_type === "new_release"
    )
      ? catalogService.listCatalogProductProfiles({}, { take: 2_500 }) as Promise<
          CatalogProductProfileRecord[]
        >
      : Promise.resolve([]),
  ])

  const candidateIds = Array.from(
    new Set([
      ...memberships.map((membership) => membership.product_id),
      ...profiles.map((profile) => profile.product_id),
    ].filter(Boolean))
  )
  const productResult = candidateIds.length
    ? await query.graph({
        entity: "product",
        fields: ["id", "created_at"],
        filters: {
          id: candidateIds,
          status: ProductStatus.PUBLISHED,
        },
        pagination: { take: Math.min(candidateIds.length + 10, 3_000) },
      })
    : { data: [] }
  const visibleProductIds = new Set(
    productResult.data
      .map((product) => toString(product.id))
      .filter((id): id is string => Boolean(id))
  )
  const productCreatedAt = new Map(
    productResult.data.flatMap((product) => {
      const id = toString(product.id)
      return id ? [[id, product.created_at] as const] : []
    })
  )
  const membershipsByShelf = new Map<string, CatalogShelfProductRecord[]>()
  memberships.forEach((membership) => {
    const existing = membershipsByShelf.get(membership.shelf_id) ?? []
    existing.push(membership)
    membershipsByShelf.set(membership.shelf_id, existing)
  })

  const resolvedShelves = activeShelves.map((shelf) => {
    const automaticProductIds = profiles
      .filter((profile) =>
        isNewReleaseCandidate({
          shelf,
          releaseDate: profile.release_date,
          createdAt: productCreatedAt.get(profile.product_id),
          now,
        })
      )
      .sort((left, right) => {
        const leftDate = toTimestamp(
          left.release_date ?? productCreatedAt.get(left.product_id)
        )
        const rightDate = toTimestamp(
          right.release_date ?? productCreatedAt.get(right.product_id)
        )
        return rightDate - leftDate || left.product_id.localeCompare(right.product_id)
      })
      .map((profile) => profile.product_id)

    return {
      shelf: serializeCatalogShelf(shelf),
      productIds: resolveShelfProductIds({
        shelf,
        memberships: membershipsByShelf.get(shelf.id) ?? [],
        automaticProductIds,
        visibleProductIds,
        now,
      }),
    }
  })

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
  )
  res.setHeader("Vary", "x-publishable-api-key")
  res.status(200).json({ shelves: resolvedShelves })
}
