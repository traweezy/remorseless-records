import type { HttpTypes } from "@medusajs/types"
import { unstable_cache } from "next/cache"
import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import {
  getCollectionProductsByHandle,
  getProductsByIds,
  getRecentProducts,
} from "@/lib/data/products"
import { normalizeRibbonLabel } from "@/lib/products/ribbons"
import {
  fetchProviderRead,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"

type StoreProduct = HttpTypes.StoreProduct

export type HomepageShelf = {
  handle: string
  title: string
  description: string
  showRibbon: boolean
  ribbonLabel: string | null
  ribbonPriority: number
  products: StoreProduct[]
}

const shelfSchema = z.object({
  shelf: z.object({
    handle: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    showRibbon: z.boolean().optional().default(false),
    ribbonLabel: z.string().trim().nullable().optional(),
    ribbonPriority: z.number().int().min(0).optional().default(100),
  }),
  productIds: z.array(z.string().trim().min(1)).max(50),
})

const responseSchema = z.object({
  shelves: z.array(shelfSchema).max(50),
})

const shelfDefaults = {
  featured: {
    title: "Featured Picks",
    description: "Curated selection of albums we can't stop spinning",
  },
  "new-releases": {
    title: "New in Store",
    description: "The latest and greatest, available now",
  },
  "staff-picks": {
    title: "Staff Signals",
    description:
      "Releases we can't stop looping. Tuned for the true devotees only.",
  },
} as const

type ShelfHandle = keyof typeof shelfDefaults
const shelfHandles = Object.keys(shelfDefaults) as ShelfHandle[]

const normalizeDescription = (
  value: string | null | undefined,
  fallback: string
): string => {
  const normalized = value?.trim()
  return normalized?.length ? normalized : fallback
}

const fetchCatalogShelves = async (): Promise<
  z.infer<typeof responseSchema>["shelves"] | null
> => {
  try {
    const url = new URL("/store/catalog/shelves", runtimeEnv.medusaBackendUrl)
    url.searchParams.set("handles", shelfHandles.join(","))
    const response = await fetchProviderRead(url.toString(), {
      headers: {
        "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
      },
      next: { revalidate: 60, tags: ["catalog-shelves"] },
    })
    if (!response.ok) {
      console.error(
        "[catalog-shelves] Failed to fetch shelves",
        response.status
      )
      return null
    }

    const parsed = responseSchema.safeParse(await response.json())
    if (!parsed.success) {
      console.error("[catalog-shelves] Invalid shelf response")
      return null
    }
    return parsed.data.shelves
  } catch (error) {
    console.error("[catalog-shelves] Failed to fetch shelves", {
      failure: toProviderRequestError(error).kind,
    })
    return null
  }
}

const loadLegacyFallback = async (
  handle: ShelfHandle
): Promise<StoreProduct[]> => {
  if (handle === "new-releases") {
    const collectionProducts = await getCollectionProductsByHandle(handle, 12)
    return collectionProducts.length
      ? collectionProducts
      : getRecentProducts(12)
  }
  return getCollectionProductsByHandle(handle, 12)
}

export const getHomepageShelves = unstable_cache(
  async (): Promise<Record<ShelfHandle, HomepageShelf>> => {
    const response = await fetchCatalogShelves()
    const shelves = await Promise.all(
      shelfHandles.map(async (handle) => {
        const defaults = shelfDefaults[handle]
        const resolved = response?.find(
          (entry) => entry.shelf.handle === handle
        )
        const products = resolved
          ? await getProductsByIds(resolved.productIds)
          : await loadLegacyFallback(handle)

        return [
          handle,
          {
            handle,
            title: resolved?.shelf.title ?? defaults.title,
            description: normalizeDescription(
              resolved?.shelf.description,
              defaults.description
            ),
            showRibbon: resolved?.shelf.showRibbon ?? false,
            ribbonLabel: resolved?.shelf.showRibbon
              ? normalizeRibbonLabel(
                  resolved.shelf.ribbonLabel ?? resolved.shelf.title
                )
              : null,
            ribbonPriority: resolved?.shelf.ribbonPriority ?? 100,
            products,
          },
        ] as const
      })
    )

    return Object.fromEntries(shelves) as Record<ShelfHandle, HomepageShelf>
  },
  ["homepage-catalog-shelves"],
  { revalidate: 60, tags: ["catalog-shelves", "products"] }
)
