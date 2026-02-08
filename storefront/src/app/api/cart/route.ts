import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { createCart } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const createCartSchema = z
  .object({
    region_id: z.string().trim().min(1).optional(),
  })
  .strict()

export const POST = async (request: Request): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:create",
      max: 60,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const parsed = await parseJsonBody(request, createCartSchema, {
      maxBytes: 2 * 1024,
      requireJsonContentType: false,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const regionId = parsed.data.region_id
    const cart = await createCart(regionId)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to create cart")
    return jsonApiError("Unable to create a cart right now.", 500)
  }
}
