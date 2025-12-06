import { NextResponse } from "next/server"
import { z } from "zod"

import { getProductByHandle } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"

const requestSchema = z.object({
  handles: z.array(z.string().min(1)).max(50),
})

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json()
    const parsed = requestSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid payload", errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const normalizedHandles = Array.from(
      new Set(
        parsed.data.handles
          .map((handle) => handle?.trim().toLowerCase())
          .filter((handle): handle is string => Boolean(handle))
      )
    )

    if (!normalizedHandles.length) {
      return NextResponse.json({ hits: [] })
    }

    const hydrated = await Promise.all(
      normalizedHandles.map(async (handle) => {
        const product = await getProductByHandle(handle)
        if (!product) {
          return null
        }
        return mapStoreProductToSearchHit(product)
      })
    )

    return NextResponse.json({
      hits: hydrated.filter(
        (hit): hit is NonNullable<typeof hit> => Boolean(hit)
      ),
    })
  } catch (error) {
    console.error("[api/catalog/hydrate] Failed to hydrate handles", error)
    return NextResponse.json(
      { message: "Failed to hydrate catalog entries" },
      { status: 500 }
    )
  }
}
