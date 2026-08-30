import { queryOptions } from "@tanstack/react-query"
import { z } from "zod"

import { requestAdminJson, type AdminSdkClient } from "../../lib/admin-request"
import type { AdminProduct } from "./catalog-merchandising-types"

export const catalogProductPageSize = 20
const MAX_SELECTED_PRODUCTS = 100

const productSchema = z.object({
  handle: z.string().nullable().optional(),
  id: z.string().trim().min(1),
  thumbnail: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
})

const productListSchema = z.object({
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  products: z.array(productSchema),
})

type ProductListResponse = z.infer<typeof productListSchema>

export type CatalogProductPage = {
  count: number
  limit: number
  offset: number
  products: AdminProduct[]
}

type ProductPageRequest = {
  client?: AdminSdkClient
  offset: number
  search: string
  signal?: AbortSignal
}

type SelectedProductsRequest = {
  client?: AdminSdkClient
  ids: string[]
  signal?: AbortSignal
}

const normalizeProduct = (
  product: ProductListResponse["products"][number]
): AdminProduct => ({
  handle: product.handle?.trim() || null,
  id: product.id,
  thumbnail: product.thumbnail?.trim() || null,
  title: product.title?.trim() || "Untitled product",
})

export const normalizeCatalogProductSearch = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 100)

export const normalizeCatalogProductIds = (ids: string[]): string[] =>
  [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    MAX_SELECTED_PRODUCTS
  )

export const loadCatalogProductPage = async ({
  client,
  offset,
  search,
  signal,
}: ProductPageRequest): Promise<CatalogProductPage> => {
  const normalizedSearch = normalizeCatalogProductSearch(search)
  const response = await requestAdminJson({
    ...(client ? { client } : {}),
    path: "/admin/products",
    query: {
      fields: "id,title,handle,thumbnail",
      limit: catalogProductPageSize,
      offset,
      order: "title",
      ...(normalizedSearch ? { q: normalizedSearch } : {}),
    },
    schema: productListSchema,
    ...(signal ? { signal } : {}),
  })

  return {
    count: response.count,
    limit: response.limit,
    offset: response.offset,
    products: response.products.map(normalizeProduct),
  }
}

export const loadCatalogProductsById = async ({
  client,
  ids,
  signal,
}: SelectedProductsRequest): Promise<AdminProduct[]> => {
  const normalizedIds = normalizeCatalogProductIds(ids)
  if (normalizedIds.length === 0) {
    return []
  }

  const response = await requestAdminJson({
    ...(client ? { client } : {}),
    path: "/admin/products",
    query: {
      fields: "id,title,handle,thumbnail",
      id: normalizedIds,
      limit: normalizedIds.length,
      offset: 0,
      order: "title",
    },
    schema: productListSchema,
    ...(signal ? { signal } : {}),
  })

  return response.products.map(normalizeProduct)
}

export const catalogProductPageQueryOptions = ({
  offset,
  search,
}: {
  offset: number
  search: string
}) => {
  const normalizedSearch = normalizeCatalogProductSearch(search)
  return queryOptions({
    queryFn: ({ signal }) =>
      loadCatalogProductPage({
        offset,
        search: normalizedSearch,
        signal,
      }),
    queryKey: [
      "catalog",
      "merchandising",
      "product-page",
      normalizedSearch,
      offset,
    ] as const,
    retry: 1,
    staleTime: 30_000,
  })
}

export const catalogSelectedProductsQueryOptions = (ids: string[]) => {
  const normalizedIds = normalizeCatalogProductIds(ids).sort()
  return queryOptions({
    enabled: normalizedIds.length > 0,
    queryFn: ({ signal }) =>
      loadCatalogProductsById({ ids: normalizedIds, signal }),
    queryKey: [
      "catalog",
      "merchandising",
      "selected-products",
      ...normalizedIds,
    ] as const,
    retry: 1,
    staleTime: 60_000,
  })
}
