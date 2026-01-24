import { NextResponse } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { createCart } from "@/lib/cart/api"

export const POST = async (request: Request): Promise<Response> => {
  try {
    noStore()
    const body = (await request.json().catch(() => ({}))) as unknown
    let regionId: string | undefined

    if (body && typeof body === "object" && "region_id" in body) {
      const value = (body as { region_id?: unknown }).region_id
      if (typeof value === "string" && value.trim()) {
        regionId = value
      }
    }

    const cart = await createCart(regionId)
    return NextResponse.json({ cart })
  } catch (error) {
    console.error("Failed to create cart", error)
    return NextResponse.json(
      { error: "Unable to create a cart right now." },
      { status: 500 }
    )
  }
}
