import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { backendBaseUrl, withBackendHeaders } from "@/config/backend"

type RouteParams = {
  params: Promise<{
    handle: string
  }>
}

export const GET = async (
  _request: NextRequest,
  { params }: RouteParams
): Promise<Response> => {
  const { handle: rawHandle } = await params
  const handle = rawHandle?.trim()

  if (!handle) {
    return NextResponse.json(
      { error: "Product handle is required" },
      { status: 400 }
    )
  }

  try {
    const response = await fetch(
      `${backendBaseUrl}/store/products/${encodeURIComponent(handle)}`,
      {
        cache: "no-store",
        headers: withBackendHeaders(),
      }
    )

    if (response.status === 404) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    if (!response.ok) {
      throw new Error(`Upstream product fetch failed: ${response.status}`)
    }

    const payload = (await response.json()) as { product?: unknown }
    const product = payload.product

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error("Failed to load product for quick shop", error)
    return NextResponse.json(
      { error: "Unable to load product" },
      { status: 500 }
    )
  }
}
