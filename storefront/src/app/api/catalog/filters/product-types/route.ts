import { getCatalogProductTypeOptions } from "@/lib/catalog/filters.server"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const GET = async (request: Request) => {
  const rateLimited = enforceRateLimit(request, {
    key: "api:catalog:filters:product-types",
    max: 180,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  try {
    const options = await getCatalogProductTypeOptions()
    return jsonApiResponse({ options })
  } catch {
    console.error("/api/catalog/filters/product-types failed")
    return jsonApiError("Unable to load product type filters", 500)
  }
}
