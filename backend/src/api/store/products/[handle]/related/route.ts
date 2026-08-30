import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError, ProductStatus } from "@medusajs/framework/utils"

import {
  listVisibleProductPage,
  listVisibleProductsByIds,
  resolveStoreProductVisibility,
} from "@/lib/store-product-visibility"

type StoreProduct = Record<string, unknown> & {
  categories?: Array<{
    handle?: string | null
    name?: string | null
    parent_category?: unknown
  }> | null
  collection?: { id?: string | null; title?: string | null } | null
  collection_id?: string | null
  handle?: string | null
  id?: string | null
  metadata?: Record<string, unknown> | null
  title?: string | null
}

const PRODUCT_SELECT = [
  "id",
  "handle",
  "title",
  "metadata",
  "status",
  "collection_id",
  "collection.id",
  "collection.title",
  "categories.id",
  "categories.handle",
  "categories.name",
  "categories.parent_category_id",
  "categories.parent_category.id",
  "categories.parent_category.handle",
  "categories.parent_category.name",
] as const
const MAX_RELATED_CANDIDATES = 100
const MAX_SUGGESTIONS = 12

type ProductSlug = {
  artistSlug: string
  albumSlug: string
}

const slugify = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.length ? normalized : null
}

const normalizeHandle = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

const findArtistCategory = (
  categories: StoreProduct["categories"]
): { name: string; handle: string } | null => {
  if (!categories?.length) {
    return null
  }

  for (const category of categories) {
    let current = category as
      | { handle?: string | null; parent_category?: unknown }
      | null
      | undefined
    let hasArtistAncestor = false
    let depth = 0

    while (current && depth < 10) {
      const handle = normalizeHandle(current.handle)
      if (handle === "artists") {
        hasArtistAncestor = true
        break
      }
      current =
        current.parent_category && typeof current.parent_category === "object"
          ? (current.parent_category as typeof current)
          : null
      depth += 1
    }

    const handle = normalizeHandle(category.handle)
    if (!hasArtistAncestor || !handle) {
      continue
    }
    const name =
      typeof category.name === "string" && category.name.trim().length
        ? category.name.trim()
        : handle
    return { name, handle }
  }

  return null
}

const buildProductSlugParts = (product: StoreProduct): ProductSlug => {
  const meta = product.metadata ?? undefined
  const metaArtist =
    typeof meta?.artist === "string"
      ? meta.artist
      : typeof meta?.Artist === "string"
        ? meta.Artist
        : typeof meta?.artist_name === "string"
          ? meta.artist_name
          : null
  const metaAlbum =
    typeof meta?.album === "string"
      ? meta.album
      : typeof meta?.Album === "string"
        ? meta.Album
        : typeof meta?.release === "string"
          ? meta.release
          : null
  const metaArtistSlug =
    typeof meta?.artist_slug === "string"
      ? meta.artist_slug
      : typeof meta?.artistSlug === "string"
        ? meta.artistSlug
        : null
  const metaAlbumSlug =
    typeof meta?.album_slug === "string"
      ? meta.album_slug
      : typeof meta?.albumSlug === "string"
        ? meta.albumSlug
        : null
  const title = typeof product.title === "string" ? product.title : ""
  const collectionTitle =
    typeof product.collection?.title === "string"
      ? product.collection.title
      : null
  const artistCategory = findArtistCategory(product.categories)

  const parsedTitle = (() => {
    if (title.includes(" - ")) {
      const [maybeArtistRaw, ...rest] = title.split(" - ")
      const maybeArtist = maybeArtistRaw?.trim() ?? ""
      const album = rest.join(" - ").trim()
      if (maybeArtist.length && album.length) {
        return { artist: maybeArtist, album }
      }
    }
    const fallback = collectionTitle ?? "Remorseless Records"
    return { artist: fallback, album: fallback }
  })()
  const artist = metaArtist ?? artistCategory?.name ?? parsedTitle.artist
  const album = metaAlbum ?? parsedTitle.album ?? artist

  return {
    artistSlug:
      slugify(metaArtistSlug) ??
      slugify(artistCategory?.handle ?? artist) ??
      "",
    albumSlug: slugify(metaAlbumSlug) ?? slugify(album) ?? "",
  }
}

const productId = (product: StoreProduct): string | null =>
  typeof product.id === "string" && product.id.trim().length
    ? product.id.trim()
    : null

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const handle =
    typeof req.params?.handle === "string" ? req.params.handle.trim() : null
  if (!handle || handle.length > 200) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product handle is required"
    )
  }

  const { query, salesChannelIds } = resolveStoreProductVisibility(req)
  const { data: targetCandidates } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { handle, status: ProductStatus.PUBLISHED },
    pagination: { take: 1 },
  })
  const targetId =
    typeof targetCandidates[0]?.id === "string" ? targetCandidates[0].id : null
  const [product] = targetId
    ? await listVisibleProductsByIds<StoreProduct>({
        fields: PRODUCT_SELECT,
        productIds: [targetId],
        query,
        salesChannelIds,
      })
    : []
  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product ${handle} not found`
    )
  }

  const { products: candidates } = await listVisibleProductPage<StoreProduct>({
    direction: "DESC",
    fields: PRODUCT_SELECT,
    limit: MAX_RELATED_CANDIDATES,
    query,
    salesChannelIds,
  })
  const seen = new Set<string>(targetId ? [targetId] : [])
  const suggestions: StoreProduct[] = []
  const targetSlug = buildProductSlugParts(product)
  const collectionId = product.collection?.id ?? product.collection_id ?? null
  const genreSet = new Set(
    (product.categories ?? [])
      .map((category) => normalizeHandle(category.handle))
      .filter((value): value is string => Boolean(value))
  )
  const collectionMatches: StoreProduct[] = []
  const sameArtist: StoreProduct[] = []
  const genreMatches: StoreProduct[] = []
  const fallback: StoreProduct[] = []

  candidates.forEach((candidate) => {
    const id = productId(candidate)
    if (!id || seen.has(id) || candidate.handle === product.handle) {
      return
    }
    const candidateCollectionId =
      candidate.collection?.id ?? candidate.collection_id ?? null
    if (collectionId && candidateCollectionId === collectionId) {
      collectionMatches.push(candidate)
      return
    }
    const slug = buildProductSlugParts(candidate)
    if (
      targetSlug.artistSlug &&
      slug.artistSlug.toLowerCase() === targetSlug.artistSlug.toLowerCase()
    ) {
      sameArtist.push(candidate)
      return
    }
    const candidateGenres = (candidate.categories ?? [])
      .map((category) => normalizeHandle(category.handle))
      .filter((value): value is string => Boolean(value))
    if (
      candidateGenres.some((candidateGenre) => genreSet.has(candidateGenre))
    ) {
      genreMatches.push(candidate)
      return
    }
    fallback.push(candidate)
  })

  for (const pool of [collectionMatches, sameArtist, genreMatches, fallback]) {
    for (const candidate of pool) {
      if (suggestions.length >= MAX_SUGGESTIONS) {
        break
      }
      const id = productId(candidate)
      if (!id || seen.has(id)) {
        continue
      }
      seen.add(id)
      suggestions.push(candidate)
    }
  }

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
  )
  res.setHeader("Vary", "x-publishable-api-key")
  res.status(200).json({ products: suggestions })
}
