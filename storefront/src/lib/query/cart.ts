import type { HttpTypes } from "@medusajs/types"
import { QueryClient, dehydrate, useQuery, type UseQueryResult } from "@tanstack/react-query"

export type StoreCart = HttpTypes.StoreCart | null

export const cartQueryKey = () => ["cart"] as const

export const cartQueryOptions = () => ({
  queryKey: cartQueryKey(),
  queryFn: async (): Promise<StoreCart> => {
    const response = await fetch("/api/cart", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    })

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }

      throw new Error(`Unable to load cart (status ${response.status})`)
    }

    const payload = (await response.json()) as { cart: StoreCart }
    return payload.cart ?? null
  },
})

export const createDehydratedCartState = (cart: StoreCart) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(cartQueryKey(), cart)
  return dehydrate(queryClient)
}

export const useCartQuery = (): UseQueryResult<StoreCart, Error> =>
  useQuery(cartQueryOptions())

export const prefetchCartQuery = (queryClient: QueryClient) =>
  queryClient.prefetchQuery(cartQueryOptions())

