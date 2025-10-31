"use client"

import { getBrowserSearchClient } from "@/lib/search/client"
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  searchProductsWithClient,
} from "@/lib/search/search"

export const searchProductsBrowser = async (
  request: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const client = getBrowserSearchClient()
  return searchProductsWithClient(client, request)
}
