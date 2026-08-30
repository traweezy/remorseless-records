import { unstable_cache } from "next/cache"

import { toProviderRequestError } from "@/lib/http/provider-boundary"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"
import type { BundleComposition } from "@/types/bundle"

type BundleCompositionResponse = {
  bundle: BundleComposition
}

const fetchBundleComposition = async (
  handle: string,
  request?: Request
): Promise<BundleComposition | null> => {
  try {
    const path = `/store/catalog/products/${encodeURIComponent(handle)}/bundle`
    const response = request
      ? await correlatedMedusaFetch<BundleCompositionResponse>(request, path, {
          method: "GET",
        })
      : await fetchMedusaStoreRead<BundleCompositionResponse>(path, {
          method: "GET",
        })
    return response.bundle.componentCount > 0 ? response.bundle : null
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
