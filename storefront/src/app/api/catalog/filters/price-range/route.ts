import { getCatalogPriceRange } from "@/lib/catalog/filters.server"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const GET = async (request: Request) => {
  const rateLimited = enforceRateLimit(request, {
    key: "api:catalog:filters:price-range",
    max: 180,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  try {
    const range = await getCatalogPriceRange()
    return jsonApiResponse({ range })
  } catch {
    console.error("/api/catalog/filters/price-range failed")
    return jsonApiError("Unable to load price range", 500)
  }
}
