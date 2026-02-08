import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { setCartAddresses } from "@/lib/cart/api"
import type { StoreCartAddressInput } from "@/lib/cart/types"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const addressSchema = z
  .object({
    first_name: z.string().trim().min(1).max(120),
    last_name: z.string().trim().min(1).max(120),
    address_1: z.string().trim().min(1).max(255),
    city: z.string().trim().min(1).max(120),
    postal_code: z.string().trim().min(1).max(40),
    country_code: z.string().trim().length(2),
    province: z.string().trim().max(120).optional(),
    address_2: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(150).optional(),
  })
  .strict()

const addressesSchema = z
  .object({
    shipping_address: addressSchema,
    billing_address: addressSchema.optional(),
  })
  .strict()

const toStoreAddressInput = (
  value: z.infer<typeof addressSchema>
): StoreCartAddressInput => ({
  first_name: value.first_name,
  last_name: value.last_name,
  address_1: value.address_1,
  city: value.city,
  postal_code: value.postal_code,
  country_code: value.country_code,
  ...(value.province ? { province: value.province } : {}),
  ...(value.address_2 ? { address_2: value.address_2 } : {}),
  ...(value.phone ? { phone: value.phone } : {}),
  ...(value.company ? { company: value.company } : {}),
})

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:addresses",
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
    const parsed = await parseJsonBody(request, addressesSchema, {
      maxBytes: 12 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const payload: {
      shipping_address: StoreCartAddressInput
      billing_address?: StoreCartAddressInput
    } = {
      shipping_address: toStoreAddressInput(parsed.data.shipping_address),
    }

    if (parsed.data.billing_address) {
      payload.billing_address = toStoreAddressInput(parsed.data.billing_address)
    }

    const cart = await setCartAddresses(cartId, payload)

    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to update cart addresses")
    return jsonApiError("Unable to update cart addresses.", 500)
  }
}
