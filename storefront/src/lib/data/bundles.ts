import { unstable_cache } from "next/cache"

import { toProviderRequestError } from "@/lib/http/provider-boundary"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"
import {
  bundleCompositionResponseSchema,
  type BundleComposition,
} from "@/types/bundle"

const fetchBundleComposition = async (
  handle: string,
  request?: Request
): Promise<BundleComposition | null> => {
  try {
    const path = `/store/catalog/products/${encodeURIComponent(handle)}/bundle`
    const rawResponse: unknown = request
      ? await correlatedMedusaFetch<unknown>(request, path, {
          method: "GET",
        })
      : await fetchMedusaStoreRead<unknown>(path, {
          method: "GET",
        })
    const response = bundleCompositionResponseSchema.parse(rawResponse)
    return response.bundle && response.bundle.componentCount > 0
      ? response.bundle
      : null
  } catch (error) {
    const providerError = toProviderRequestError(error)
    console.error("[bundle] Failed to load composition", {
      failure: providerError.kind,
    })
    if (request) {
      throw providerError
    }
    return null
  }
}

export const getBundleComposition = unstable_cache(
  async (handle: string): Promise<BundleComposition | null> =>
    fetchBundleComposition(handle),
  ["bundle-composition"],
  { revalidate: 60, tags: ["products", "bundles"] }
)

export const getCorrelatedBundleComposition = (
  handle: string,
  request: Request
): Promise<BundleComposition | null> => fetchBundleComposition(handle, request)
