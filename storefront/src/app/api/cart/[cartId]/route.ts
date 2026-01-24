import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { getCart } from "@/lib/cart/api"

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null
  }

  const typed = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof typed.status === "number") {
    return typed.status
  }

  if (typeof typed.statusCode === "number") {
    return typed.statusCode
  }

  if (typeof typed.response?.status === "number") {
    return typed.response.status
  }

  return null
}

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const cart = await getCart(cartId)
    return NextResponse.json({ cart })
  } catch (error) {
    const status = getErrorStatus(error)
    if (status === 404) {
      return NextResponse.json({ cart: null })
    }

    console.error("Failed to retrieve cart", error)
    return NextResponse.json(
      { error: "Unable to retrieve cart at this time." },
      { status: 500 }
    )
  }
}
