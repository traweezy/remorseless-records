"use client"

import {
  type ProductSearchRequest,
  type ProductSearchResponse,
} from "@/lib/search/search"

export const searchProductsBrowser = async (
  request: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const response = await fetch("/api/search/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Search request failed (${response.status}): ${text}`)
  }

  return (await response.json()) as ProductSearchResponse
}
