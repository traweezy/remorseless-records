import { unstable_cache } from "next/cache"

import { medusa } from "@/lib/medusa"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
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
      : await medusa.client.fetch<BundleCompositionResponse>(path, {
          method: "GET",
        })
    return response.bundle.componentCount > 0 ? response.bundle : null
  } catch (error) {
    console.error(`[bundle:${handle}] Failed to load composition`, {
      reason: error instanceof Error ? error.message : error,
    })
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
