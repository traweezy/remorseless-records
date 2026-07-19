import { unstable_cache } from "next/cache"

import { medusa } from "@/lib/medusa"
import type { BundleComposition } from "@/types/bundle"

type BundleCompositionResponse = {
  bundle: BundleComposition
}

export const getBundleComposition = unstable_cache(
  async (handle: string): Promise<BundleComposition | null> => {
    try {
      const response = await medusa.client.fetch<BundleCompositionResponse>(
        `/store/catalog/products/${encodeURIComponent(handle)}/bundle`,
        { method: "GET" }
      )
      return response.bundle.componentCount > 0 ? response.bundle : null
    } catch (error) {
      console.error(`[bundle:${handle}] Failed to load composition`, {
        reason: error instanceof Error ? error.message : error,
      })
      return null
    }
  },
  ["bundle-composition"],
  { revalidate: 60, tags: ["products", "bundles"] }
)
