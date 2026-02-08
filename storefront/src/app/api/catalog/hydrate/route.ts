import { NextResponse } from "next/server"
import { z } from "zod"

import { getProductByHandle } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const requestSchema = z.object({
  handles: z.array(z.string().min(1)).max(50),
}).strict()

export async function POST(request: Request) {
  try {
    const rateLimited = enforceRateLimit(request, {
      key: "api:catalog:hydrate",
      max: 45,
      windowMs: 60_000,
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

    const hydrated = await Promise.all(
      normalizedHandles.map(async (handle) => {
        const product = await getProductByHandle(handle)
        if (!product) {
          return null
        }
        return mapStoreProductToSearchHit(product)
      })
    )

    return jsonApiResponse({
      hits: hydrated.filter(
        (hit): hit is NonNullable<typeof hit> => Boolean(hit)
      ),
    })
  } catch {
    console.error("[api/catalog/hydrate] Failed to hydrate handles")
    return jsonApiError("Failed to hydrate catalog entries", 500)
  }
}
