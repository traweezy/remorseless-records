import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { setCartEmail } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const emailSchema = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict()

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:email",
      max: 90,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const { cartId } = await params
    const parsed = await parseJsonBody(request, emailSchema, {
      maxBytes: 2 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const cart = await setCartEmail(cartId, parsed.data.email)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to update cart email")
    return jsonApiError("Unable to update cart email.", 500)
  }
}
