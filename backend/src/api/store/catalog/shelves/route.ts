import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { z } from "zod"

import {
  getCatalogSourceCreatedAt,
  isNewReleaseCandidate,
  resolveShelfProductIds,
} from "@/lib/catalog/shelves"
import { callCatalogServiceMethod } from "@/lib/catalog/catalog-service-method"
import type CatalogModuleService from "@/modules/catalog/service"
import { serializeCatalogShelf } from "@/modules/catalog/serializers"
import {
  listVisibleProductsByIds,
  resolveStoreProductVisibility,
} from "@/lib/store-product-visibility"
import { readStoreShelfProductProjections } from "@/lib/store-product-projections"
import {
  readStoreShelfMemberships,
  readStoreShelfPage,
  readStoreShelfProductProfiles,
} from "@/lib/store-module-projections"

type CatalogService = InstanceType<typeof CatalogModuleService>
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

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const { handles } = listQuerySchema.parse(req.query)
  const now = new Date()
  const catalogService = req.scope.resolve<CatalogService>("catalog")
  const { query, salesChannelIds } = resolveStoreProductVisibility(req)
  const shelfFilters: Record<string, unknown> = { is_active: true }
  if (handles?.length) {
    shelfFilters.handle = handles
  }

  const rawShelfPage = await callCatalogServiceMethod(
    catalogService,
    ["listAndCountCatalogShelves", "listAndCountCatalogShelfs"],
    [
      shelfFilters,
      {
        take: 50,
        order: { ribbon_priority: "ASC", created_at: "ASC" },
      },
    ]
  )
  const { records: shelves } = readStoreShelfPage(rawShelfPage)
  const activeShelves = shelves.filter((shelf) => {
    const startsAt = toTimestamp(shelf.starts_at)
    const endsAt = toTimestamp(shelf.ends_at)
    return (
      (!startsAt || startsAt <= now.getTime()) &&
      (!endsAt || endsAt > now.getTime())
    )
  })
  const shelfIds = activeShelves.map((shelf) => shelf.id)

  const [rawMemberships, rawProfiles] = await Promise.all([
    shelfIds.length
      ? catalogService.listCatalogShelfProducts(
          { shelf_id: shelfIds },
          { take: 2_500, order: { sort_order: "ASC" } }
        )
      : Promise.resolve([]),
    activeShelves.some(
      (shelf) =>
        (shelf.mode === "automatic" || shelf.mode === "hybrid") &&
        shelf.automation_type === "new_release"
    )
      ? catalogService.listCatalogProductProfiles({}, { take: 2_500 })
      : Promise.resolve([]),
  ])
  const memberships = readStoreShelfMemberships(rawMemberships, shelfIds)
  const profiles = readStoreShelfProductProfiles(rawProfiles)

  const candidateIds = Array.from(
    new Set(
      [
        ...memberships.map((membership) => membership.product_id),
        ...profiles.map((profile) => profile.product_id),
      ].filter(Boolean)
    )
  )
  const rawVisibleProducts = candidateIds.length
    ? await listVisibleProductsByIds({
        fields: ["id", "created_at"],
        productIds: candidateIds,
        query,
        salesChannelIds,
      })
    : []
  const visibleProducts = readStoreShelfProductProjections(rawVisibleProducts)
  const visibleProductIds = new Set(
    visibleProducts.map((product) => product.id)
  )
  const productCreatedAt = new Map(
    visibleProducts.map((product) => [product.id, product.created_at])
  )
  const membershipsByShelf = new Map<
    string,
    ReturnType<typeof readStoreShelfMemberships>
  >()
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
          createdAt:
            getCatalogSourceCreatedAt(profile.metadata) ??
            productCreatedAt.get(profile.product_id),
          now,
        })
      )
      .sort((left, right) => {
        const leftDate = toTimestamp(
          left.release_date ??
            getCatalogSourceCreatedAt(left.metadata) ??
            productCreatedAt.get(left.product_id)
        )
        const rightDate = toTimestamp(
          right.release_date ??
            getCatalogSourceCreatedAt(right.metadata) ??
            productCreatedAt.get(right.product_id)
        )
        return (
          rightDate - leftDate ||
          left.product_id.localeCompare(right.product_id)
        )
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
