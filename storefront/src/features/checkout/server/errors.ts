import "server-only"

import type { NextRequest } from "next/server"

import { mapCartError } from "@/lib/cart/errors"
import { jsonApiProblem } from "@/lib/security/route-guards"

export const checkoutOperationError = (
  request: NextRequest,
  error: unknown,
  fallback: {
    code: string
    title: string
    detail: string
  }
): Response => {
  const mapped = mapCartError(error, fallback.detail)
  console.error("Checkout operation failed", {
    code: fallback.code,
    upstream_code: mapped.code,
    status: mapped.status,
  })
  return jsonApiProblem({
    status: mapped.status,
    code: fallback.code,
    title: fallback.title,
    detail: mapped.detail,
    instance: request.nextUrl.pathname,
  })
}
