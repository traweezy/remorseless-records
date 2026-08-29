import { NextResponse } from "next/server"
import type { HttpTypes } from "@medusajs/types"
import { z } from "zod"

import { PRODUCT_DETAIL_FIELDS } from "@/lib/data/products"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { resolveRegionId } from "@/lib/regions"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const requestSchema = z
  .object({
    handles: z.array(z.string().min(1)).max(50),
  })
  .strict()

export async function POST(request: Request) {
  try {
    const rateLimited = await enforceRateLimit(request, {
      key: "api:catalog:hydrate",
      max: 45,
      windowMs: 60_000,
      onUnavailable: "local-fallback",
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const parsed = await parseJsonBody(request, requestSchema, {
      maxBytes: 10 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const normalizedHandles = Array.from(
      new Set(
        parsed.data.handles
          .map((handle) => handle?.trim().toLowerCase())
          .filter((handle): handle is string => Boolean(handle))
      )
    )

    if (!normalizedHandles.length) {
      return NextResponse.json({ hits: [] })
    }

    const regionId = await resolveRegionId(request)
    const hydrated = await Promise.all(
      normalizedHandles.map(async (handle) => {
        const { products } =
          await correlatedMedusaFetch<HttpTypes.StoreProductListResponse>(
            request,
            "/store/products",
            {
              query: {
                fields: PRODUCT_DETAIL_FIELDS,
                handle,
                limit: 1,
                region_id: regionId,
              },
            }
          )
        const product = products[0]
        if (!product) {
          return null
        }
        return mapStoreProductToSearchHit(product)
      })
    )

    return jsonApiResponse({
      hits: hydrated.filter((hit): hit is NonNullable<typeof hit> =>
        Boolean(hit)
      ),
    })
  } catch {
    console.error("[api/catalog/hydrate] Failed to hydrate handles")
    return jsonApiError(
      request,
      "Failed to hydrate catalog entries",
      500,
      "catalog_unavailable"
    )
  }
}
