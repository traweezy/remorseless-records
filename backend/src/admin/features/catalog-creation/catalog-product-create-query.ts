import { queryOptions, type QueryFunctionContext } from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"
import type {
  CatalogCreationArtistChoice,
  CatalogCreationProductChoice,
  CatalogCreationReferenceChoice,
  CatalogCreationVocabulary,
  CatalogProductCreateRequest,
} from "./catalog-product-create-form"

const PAGE_SIZE = 200

const productVariantSchema = z.object({
  id: z.string().min(1),
  inventory_quantity: z.number().nullable().optional(),
  manage_inventory: z.boolean().nullable().optional(),
  sku: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
})

const productListSchema = z.object({
  count: z.number().int().nonnegative(),
  products: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().nullable().optional(),
      variants: z.array(productVariantSchema).nullable().optional(),
    })
  ),
})

const catalogArtistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

const catalogReferenceSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
  kind: z.enum([
    "format",
    "format_detail",
    "genre",
    "label",
    "merch_type",
    "product_type",
    "utility_tag",
  ]),
  label: z.string().min(1),
})

const catalogArtistListSchema = z.object({
  artists: z.array(catalogArtistSchema),
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
})

const catalogReferenceListSchema = z.object({
  values: z.array(catalogReferenceSchema),
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
})

export const catalogProductCreateResponseSchema = z.object({
  kind: z.enum(["music_release", "merch", "fixed_bundle", "mystery_bundle"]),
  productId: z.string().min(1),
  profileId: z.string().min(1),
  replayed: z.boolean(),
  variantIds: z.array(z.string().min(1)).min(1),
})

export type CatalogProductCreateResponse = z.infer<
  typeof catalogProductCreateResponseSchema
>

const catalogProductCreationStatusSchema = z.object({
  state: z.enum([
    "absent",
    "compensated",
    "failed",
    "pending",
    "succeeded",
    "unavailable",
  ]),
})

export type CatalogProductCreationStatus = z.infer<
  typeof catalogProductCreationStatusSchema
>

export type CatalogProductCreationRetryDecision =
  "blocked" | "new-key" | "same-key" | "wait"

export const decideCatalogProductCreationRetry = (
  state: CatalogProductCreationStatus["state"]
): CatalogProductCreationRetryDecision => {
  if (state === "compensated") {
    return "new-key"
  }
  if (state === "absent" || state === "succeeded") {
    return "same-key"
  }
  if (state === "pending") {
    return "wait"
  }
  return "blocked"
}

export type CatalogCreationProductChoiceWithStock = Omit<
  CatalogCreationProductChoice,
  "variants"
> & {
  variants: Array<
    CatalogCreationProductChoice["variants"][number] & {
      inventoryQuantity: number | null
      managesInventory: boolean
    }
  >
}

export const catalogProductChoicesQueryKey = [
  "catalog",
  "product-create-choices",
] as const

export const catalogCreationVocabularyQueryKey = [
  "catalog",
  "product-create-vocabulary",
] as const

const vocabularyPageOffsets = (count: number): number[] =>
  Array.from(
    { length: Math.max(0, Math.ceil(count / 500) - 1) },
    (_, index) => (index + 1) * 500
  )

const loadCatalogArtistPage = async (offset: number, signal: AbortSignal) =>
  requestAdminJson({
    path: "/admin/catalog/artists",
    query: {
      direction: "asc",
      limit: 500,
      offset,
      order: "name",
    },
    schema: catalogArtistListSchema,
    signal,
  })

const loadCatalogReferencePage = async (offset: number, signal: AbortSignal) =>
  requestAdminJson({
    path: "/admin/catalog/reference-values",
    query: {
      active: "true",
      direction: "asc",
      limit: 500,
      offset,
      order: "rank",
    },
    schema: catalogReferenceListSchema,
    signal,
  })

export const loadCatalogCreationVocabulary = async (
  signal: AbortSignal
): Promise<CatalogCreationVocabulary> => {
  const [firstArtists, firstReferences] = await Promise.all([
    loadCatalogArtistPage(0, signal),
    loadCatalogReferencePage(0, signal),
  ])
  const [remainingArtists, remainingReferences] = await Promise.all([
    Promise.all(
      vocabularyPageOffsets(firstArtists.count).map((offset) =>
        loadCatalogArtistPage(offset, signal)
      )
    ),
    Promise.all(
      vocabularyPageOffsets(firstReferences.count).map((offset) =>
        loadCatalogReferencePage(offset, signal)
      )
    ),
  ])
  return {
    artists: [firstArtists, ...remainingArtists].flatMap(
      (page): CatalogCreationArtistChoice[] => page.artists
    ),
    references: [firstReferences, ...remainingReferences].flatMap(
      (page): CatalogCreationReferenceChoice[] => page.values
    ),
  }
}

export const catalogCreationVocabularyQueryOptions = () =>
  queryOptions({
    queryFn: ({ signal }) => loadCatalogCreationVocabulary(signal),
    queryKey: catalogCreationVocabularyQueryKey,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 5 * 60_000,
  })

const loadProductChoicePage = async (offset: number, signal: AbortSignal) =>
  requestAdminJson({
    path: "/admin/products",
    query: {
      fields: "id,title,*variants",
      limit: PAGE_SIZE,
      offset,
    },
    schema: productListSchema,
    signal,
  })

const loadCatalogProductChoices = async ({
  signal,
}: QueryFunctionContext<typeof catalogProductChoicesQueryKey>): Promise<
  CatalogCreationProductChoiceWithStock[]
> => {
  const first = await loadProductChoicePage(0, signal)
  const remainingOffsets = Array.from(
    { length: Math.max(0, Math.ceil(first.count / PAGE_SIZE) - 1) },
    (_, index) => (index + 1) * PAGE_SIZE
  )
  const remaining = await Promise.all(
    remainingOffsets.map((offset) => loadProductChoicePage(offset, signal))
  )
  return [first, ...remaining]
    .flatMap((page) => page.products)
    .map((product) => ({
      id: product.id,
      title: product.title?.trim() || "Untitled product",
      variants: (product.variants ?? []).map((variant) => ({
        id: variant.id,
        inventoryQuantity: variant.inventory_quantity ?? null,
        managesInventory: variant.manage_inventory ?? false,
        sku: variant.sku?.trim() || null,
        title: variant.title?.trim() || variant.sku?.trim() || "Variant",
      })),
    }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

export const catalogProductChoicesQueryOptions = () =>
  queryOptions({
    queryFn: loadCatalogProductChoices,
    queryKey: catalogProductChoicesQueryKey,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 60_000,
  })

export const createCatalogProduct = async (
  request: CatalogProductCreateRequest
): Promise<CatalogProductCreateResponse> =>
  requestAdminJson({
    body: request,
    method: "POST",
    path: "/admin/catalog/products",
    schema: catalogProductCreateResponseSchema,
    timeoutMs: 120_000,
  })

export const getCatalogProductCreationStatus = async (
  idempotencyKey: string
): Promise<CatalogProductCreationStatus> =>
  requestAdminJson({
    path: `/admin/catalog/products/status/${encodeURIComponent(idempotencyKey)}`,
    schema: catalogProductCreationStatusSchema,
  })
