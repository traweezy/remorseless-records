import { NextResponse } from "next/server"

import { getCart } from "@/lib/cart"

export const GET = async (): Promise<Response> => {
  try {
    const cart = await getCart()
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to load cart", error)
    return NextResponse.json(
      { error: "Unable to retrieve cart at this time." },
      { status: 500 }
    )
  }
}

