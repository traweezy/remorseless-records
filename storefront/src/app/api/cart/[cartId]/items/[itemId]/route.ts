import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { removeLineItem, updateLineItem } from "@/lib/cart/api"

export const PATCH = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string; itemId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId, itemId } = await params
    const body = (await request.json()) as { quantity?: number }
    const nextQuantity = Number(body.quantity ?? 0)

    if (!Number.isFinite(nextQuantity)) {
      return NextResponse.json(
        { error: "quantity must be a number." },
        { status: 400 }
      )
    }

    if (nextQuantity <= 0) {
      const cart = await removeLineItem(cartId, itemId)
      return NextResponse.json({ cart })
    }

    const cart = await updateLineItem(
      cartId,
      itemId,
      Math.max(1, Math.floor(nextQuantity))
    )

    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to update line item", error)
    return NextResponse.json(
      { error: "Unable to update cart item." },
      { status: 500 }
    )
  }
}

export const DELETE = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string; itemId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId, itemId } = await params
    const cart = await removeLineItem(cartId, itemId)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to remove line item", error)
    return NextResponse.json(
      { error: "Unable to remove cart item." },
      { status: 500 }
    )
  }
}
