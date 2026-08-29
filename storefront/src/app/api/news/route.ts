import { z } from "zod"

import { fetchNewsEntries, NEWS_PAGE_SIZE } from "@/lib/data/news"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const GET = async (request: Request) => {
  const rateLimited = await enforceRateLimit(request, {
    key: "api:news",
    max: 180,
    windowMs: 60_000,
    onUnavailable: "local-fallback",
  })
  if (rateLimited) {
    return rateLimited
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse(
    Object.fromEntries(searchParams.entries())
  )

  if (!parsed.success) {
    return jsonApiError(request, "Invalid query", 400, "invalid_query")
  }

  const limit = parsed.data.limit ?? NEWS_PAGE_SIZE
  const offset = parsed.data.offset ?? 0

  const payload = await fetchNewsEntries({ limit, offset, request })

  return jsonApiResponse(payload)
}
