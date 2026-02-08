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
  const rateLimited = enforceRateLimit(request, {
    key: "api:news",
    max: 180,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()))

  if (!parsed.success) {
    return jsonApiError("Invalid query", 400)
  }

  const limit = parsed.data.limit ?? NEWS_PAGE_SIZE
  const offset = parsed.data.offset ?? 0

  const payload = await fetchNewsEntries({ limit, offset })

  return jsonApiResponse(payload)
}
