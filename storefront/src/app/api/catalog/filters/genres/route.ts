import { getCatalogGenreOptions } from "@/lib/catalog/filters.server"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const GET = async (request: Request) => {
  const rateLimited = await enforceRateLimit(request, {
    key: "api:catalog:filters:genres",
    max: 180,
    windowMs: 60_000,
    onUnavailable: "local-fallback",
  })
  if (rateLimited) {
    return rateLimited
  }

  try {
    const options = await getCatalogGenreOptions()
    return jsonApiResponse({ options })
  } catch {
    console.error("/api/catalog/filters/genres failed")
    return jsonApiError(
      request,
      "Unable to load genre filters",
      500,
      "catalog_unavailable"
    )
  }
}
