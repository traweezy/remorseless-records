import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { PRODUCT_DETAIL_FIELDS } from "@/lib/data/products"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { resolveRegionId } from "@/lib/regions"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

type RouteParams = {
  params: Promise<{
    handle: string
  }>
}

const handleSchema = z.string().trim().min(1).max(200)

export const GET = async (
  _request: NextRequest,
  { params }: RouteParams
): Promise<Response> => {
  try {
    const rateLimited = enforceRateLimit(_request, {
      key: "api:product:detail",
      max: 240,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const { handle: rawHandle } = await params
    const parsedHandle = handleSchema.safeParse(rawHandle)
    if (!parsedHandle.success) {
      return jsonApiError(
        _request,
        "Product handle is required",
        400,
        "invalid_product_handle"
      )
    }

    const handle = parsedHandle.data
    const regionId = await resolveRegionId(_request)
    const { products } =
      await correlatedMedusaFetch<HttpTypes.StoreProductListResponse>(
        _request,
        "/store/products",
        {
          query: {
            handle,
            limit: 1,
            fields: PRODUCT_DETAIL_FIELDS,
            region_id: regionId,
          },
        }
      )

    const product = products[0]

    if (!product) {
      return jsonApiError(
        _request,
        "Product not found",
        404,
        "product_not_found"
      )
    }

    return jsonApiResponse({ product })
  } catch {
    console.error("Failed to load product for quick shop")
    return jsonApiError(
      _request,
      "Unable to load product",
      500,
      "catalog_unavailable"
    )
  }
}
