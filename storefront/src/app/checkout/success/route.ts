import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export const GET = (request: NextRequest): Response => {
  const response = NextResponse.redirect(
    new URL("/checkout/recover", request.nextUrl.origin),
    303
  )
  response.headers.set("Cache-Control", "no-store, max-age=0")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
