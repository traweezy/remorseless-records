import "server-only"

import type { HttpTypes } from "@medusajs/types"
import sanitizeHtml from "sanitize-html"

import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import {
  readCatalogPresentations,
  type CatalogPresentation,
  type PresentedStoreProduct,
} from "./presentation"

export const loadCatalogPresentations = async (
  productIds: readonly string[],
  request?: Request
): Promise<Map<string, CatalogPresentation>> => {
  const ids = [...new Set(productIds)]
  if (ids.length > 200)
    throw new Error("Catalog presentation read is too large")
  const rows = new Map<string, CatalogPresentation>()
  for (let offset = 0; offset < ids.length; offset += 25) {
    const page = ids.slice(offset, offset + 25)
    const path = "/store/catalog/presentation"
    const init = { query: { product_ids: page.join(",") } }
    const raw = request
      ? await correlatedMedusaFetch<unknown>(request, path, init)
      : await fetchMedusaStoreRead<unknown>(path, init)
    for (const row of readCatalogPresentations(raw, page))
      rows.set(row.productId, row)
  }
  return rows
}

const plainDescription = (html: string | null): string | null =>
  html === null
    ? null
    : sanitizeHtml(html.replace(/<\/(?:p|li|h[1-6])>/giu, "$&\n"), {
        allowedTags: [],
        allowedAttributes: {},
      })
        .replace(
          /&(amp|lt|gt|quot);/gu,
          (entity) =>
            ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' })[
              entity
            ] ?? entity
        )
        .trim()

export const presentStoreProducts = async (
  products: HttpTypes.StoreProduct[],
  request?: Request
): Promise<PresentedStoreProduct[]> => {
  const rows = await loadCatalogPresentations(
    products.map((product) => product.id),
    request
  )
  // Absence means publication/channel access changed between the native and
  // editorial reads. Do not resurrect a now-hidden product from the first read.
  return products.flatMap((product) => {
    const presentation = rows.get(product.id)
    if (!presentation) return []
    const profile = presentation.profile
    return [
      {
        ...product,
        presentation,
        ...(presentation.managedMedia
          ? {
              images: presentation.images.map((image, rank) => ({
                ...image,
                rank,
              })),
              thumbnail: presentation.images[0]?.url ?? null,
            }
          : {}),
        ...(profile
          ? {
              description: plainDescription(profile.descriptionHtml),
              metadata: {
                ...product.metadata,
                artist_names: profile.artists,
                product_type: profile.productType,
                tracklist: profile.tracklist,
                notes: profile.pressingNotes,
              },
            }
          : {}),
      },
    ]
  })
}

export const presentCartArtwork = async (
  cart: HttpTypes.StoreCart,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  // Order recovery preserves the purchased snapshot, regardless of current
  // product publication, editorial changes or provider availability.
  if (cart.completed_at || !cart.items?.length) return cart
  try {
    const rows = await loadCatalogPresentations(
      cart.items.flatMap((item) => (item.product_id ? [item.product_id] : [])),
      request
    )
    return {
      ...cart,
      items: cart.items.map((item) => {
        const row = item.product_id ? rows.get(item.product_id) : undefined
        const { thumbnail, ...withoutArtwork } = item
        const current = !row
          ? null
          : row.managedMedia
            ? row.images[0]?.url
            : thumbnail
        return { ...withoutArtwork, ...(current ? { thumbnail: current } : {}) }
      }),
    }
  } catch {
    // Display failure cannot turn a completed cart mutation into a false
    // failure. Hide artwork that cannot be verified instead of reviving it.
    console.warn("[cart] Managed artwork is temporarily unavailable")
    return {
      ...cart,
      items: cart.items.map(({ thumbnail: _thumbnail, ...item }) => item),
    }
  }
}
