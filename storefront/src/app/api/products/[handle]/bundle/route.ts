import type { NextRequest } from "next/server"
import { z } from "zod"

import { getBundleComposition } from "@/lib/data/bundles"
import {
  enforceRateLimit,
  jsonApiProblem,
  jsonApiResponse,
} from "@/lib/security/route-guards"

type RouteContext = {
  params: Promise<{ handle: string }>
}

const handleSchema = z.string().trim().min(1).max(200)

export const GET = async (
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> => {
  const rateLimited = enforceRateLimit(request, {
    key: "api:product:bundle",
    max: 180,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const parsed = handleSchema.safeParse((await params).handle)
  if (!parsed.success) {
    return jsonApiProblem({
      status: 400,
      code: "product_handle_invalid",
      title: "Invalid product handle",
      detail: "A valid product handle is required.",
      instance: request.nextUrl.pathname,
    })
  }

  const bundle = await getBundleComposition(parsed.data)
  return jsonApiResponse({ bundle })
}
