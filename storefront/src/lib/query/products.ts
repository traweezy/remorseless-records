import type { HttpTypes } from "@medusajs/types"
import {
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { useCallback, useRef } from "react"

import { searchProductsBrowser } from "@/lib/search/browser"
import type {
  ProductSearchRequest,
  ProductSearchResponse,
  ProductSortOption,
} from "@/lib/search/search"

type StoreProduct = HttpTypes.StoreProduct

export const productDetailQueryKey = (handle: string) => ["product", handle] as const

export const productDetailQueryOptions = (handle: string) => ({
  queryKey: productDetailQueryKey(handle),
  queryFn: async (): Promise<StoreProduct> => {
    const response = await fetch(`/api/products/${handle}`, {
      method: "GET",
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`Failed to load product (status ${response.status})`)
    }

    const payload = (await response.json()) as { product: StoreProduct }
    return payload.product
  },
})

export const useProductDetailQuery = (
  handle: string,
  options?: Omit<UseQueryOptions<StoreProduct, Error>, "queryKey" | "queryFn">
): UseQueryResult<StoreProduct, Error> =>
  useQuery({
    ...productDetailQueryOptions(handle),
    enabled: Boolean(handle),
    ...(options ?? {}),
  })

export const prefetchProductDetail = (queryClient: QueryClient, handle: string) =>
  queryClient.prefetchQuery(productDetailQueryOptions(handle))

export const useProductDetailPrefetch = (handle: string | null | undefined) => {
  const queryClient = useQueryClient()
  const prefetchedRef = useRef(false)

  return useCallback(() => {
    if (!handle || prefetchedRef.current) {
      return
    }

    prefetchedRef.current = true
    void prefetchProductDetail(queryClient, handle)
  }, [handle, queryClient])
}

export type ProductSearchParams = {
  query: string
  genres: string[]
  categories: string[]
  variants: string[]
  formats?: string[]
  limit?: number
  sort?: ProductSortOption
  inStockOnly?: boolean
}

const normalizeFilters = (values: string[]) =>
  [...values].map((value) => value.trim()).filter(Boolean).sort()

export const productSearchQueryKey = ({
  query,
  genres,
  categories,
  variants,
  formats = [],
  limit = 24,
  sort = "alphabetical",
  inStockOnly = false,
}: ProductSearchParams) =>
  [
    "search",
    query.trim(),
    normalizeFilters(genres),
    normalizeFilters(categories),
    normalizeFilters(variants),
    normalizeFilters(formats),
    limit,
    sort,
    inStockOnly ? "in-stock" : "all",
  ] as const

export const productSearchQueryOptions = ({
  query,
  genres,
  categories,
  variants,
  formats = [],
  limit = 24,
  sort,
  inStockOnly = false,
}: ProductSearchParams) => {
  const sortValue: ProductSortOption = sort ?? "alphabetical"
  return {
    queryKey: productSearchQueryKey({
      query,
      genres,
      categories,
      variants,
      formats,
      limit,
      sort: sortValue,
      inStockOnly,
    }),
    queryFn: async (): Promise<ProductSearchResponse> => {
      const request: ProductSearchRequest = {
        query,
        limit,
        filters: {
          genres,
          categories,
          variants,
          formats,
        },
        inStockOnly,
        sort: sortValue,
      }

      return searchProductsBrowser(request)
    },
  }
}

export const prefetchProductSearch = (queryClient: QueryClient, params: ProductSearchParams) =>
  queryClient.prefetchQuery(productSearchQueryOptions(params))
