import type { NextRequest } from "next/server"
import { z } from "zod"

import { getCorrelatedBundleComposition } from "@/lib/data/bundles"
import { providerProblem } from "@/lib/http/provider-boundary"
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
  const rateLimited = await enforceRateLimit(request, {
    key: "api:product:bundle",
    max: 180,
    windowMs: 60_000,
    onUnavailable: "local-fallback",
  })
  if (rateLimited) {
    return rateLimited
  }

  const parsed = handleSchema.safeParse((await params).handle)
  if (!parsed.success) {
    return jsonApiProblem({
      request,
      status: 400,
      code: "product_handle_invalid",
      title: "Invalid product handle",
      detail: "A valid product handle is required.",
      instance: request.nextUrl.pathname,
    })
  }

  try {
    const bundle = await getCorrelatedBundleComposition(parsed.data, request)
    return jsonApiResponse({ bundle })
  } catch (error) {
    const problem = providerProblem(error, "catalog")
    if (problem) {
      return jsonApiProblem({
        request,
        status: problem.status,
        code: problem.code,
        title: "Catalog service unavailable",
        detail: problem.detail,
        instance: request.nextUrl.pathname,
      })
    }
    throw error
  }
}
