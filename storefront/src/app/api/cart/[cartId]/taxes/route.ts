import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { calculateTaxes } from "@/lib/cart/api"

export const POST = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const cart = await calculateTaxes(cartId)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to calculate taxes", error)
    return NextResponse.json(
      { error: "Unable to calculate taxes right now." },
      { status: 500 }
    )
  }
}
