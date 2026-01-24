import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { setCartAddresses } from "@/lib/cart/api"
import type { StoreCartAddressInput } from "@/lib/cart/types"

const isAddress = (value: unknown): value is StoreCartAddressInput =>
  typeof value === "object" && value !== null

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json()) as {
      shipping_address?: StoreCartAddressInput
      billing_address?: StoreCartAddressInput
    }

    if (!isAddress(body?.shipping_address)) {
      return NextResponse.json(
        { error: "shipping_address is required." },
        { status: 400 }
      )
    }

    const payload: {
      shipping_address: StoreCartAddressInput
      billing_address?: StoreCartAddressInput
    } = { shipping_address: body.shipping_address }

    if (isAddress(body.billing_address)) {
      payload.billing_address = body.billing_address
    }

    const cart = await setCartAddresses(cartId, payload)

    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to update cart addresses", error)
    return NextResponse.json(
      { error: "Unable to update cart addresses." },
      { status: 500 }
    )
  }
}
