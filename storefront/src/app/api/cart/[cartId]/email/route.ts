import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { setCartEmail } from "@/lib/cart/api"

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const { cartId } = await params
    const body = (await request.json()) as { email?: string }
    const email = body?.email?.trim() ?? ""

    if (!email) {
      return NextResponse.json(
        { error: "email is required." },
        { status: 400 }
      )
    }

    const cart = await setCartEmail(cartId, email)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to update cart email", error)
    return NextResponse.json(
      { error: "Unable to update cart email." },
      { status: 500 }
    )
  }
}
