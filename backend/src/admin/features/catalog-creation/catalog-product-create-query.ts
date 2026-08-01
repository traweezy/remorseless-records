import {
  queryOptions,
  type QueryFunctionContext,
} from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"
import type {
  CatalogCreationProductChoice,
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
    }),
  ),
})

export const catalogProductCreateResponseSchema = z.object({
  kind: z.enum([
    "music_release",
    "merch",
    "fixed_bundle",
    "mystery_bundle",
  ]),
  productId: z.string().min(1),
  profileId: z.string().min(1),
  replayed: z.boolean(),
  variantIds: z.array(z.string().min(1)).min(1),
})

export type CatalogProductCreateResponse = z.infer<
  typeof catalogProductCreateResponseSchema
>

export type CatalogCreationProductChoiceWithStock =
  Omit<CatalogCreationProductChoice, "variants"> & {
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

const loadProductChoicePage = async (
  offset: number,
  signal: AbortSignal,
) =>
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
}: QueryFunctionContext<
  typeof catalogProductChoicesQueryKey
>): Promise<CatalogCreationProductChoiceWithStock[]> => {
  const first = await loadProductChoicePage(0, signal)
  const remainingOffsets = Array.from(
    { length: Math.max(0, Math.ceil(first.count / PAGE_SIZE) - 1) },
    (_, index) => (index + 1) * PAGE_SIZE,
  )
  const remaining = await Promise.all(
    remainingOffsets.map((offset) => loadProductChoicePage(offset, signal)),
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
  request: CatalogProductCreateRequest,
): Promise<CatalogProductCreateResponse> =>
  requestAdminJson({
    body: request,
    method: "POST",
    path: "/admin/catalog/products",
    schema: catalogProductCreateResponseSchema,
    timeoutMs: 120_000,
  })
