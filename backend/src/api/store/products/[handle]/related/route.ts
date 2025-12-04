import { MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
type StoreProduct = {
  id?: string | null
  handle?: string | null
  title?: string | null
  metadata?: Record<string, unknown> | null
  categories?: Array<{ handle?: string | null }> | null
  collection?: { id?: string | null; title?: string | null } | null
  collection_id?: string | null
}

type ProductModule = {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: {
      relations?: string[]
      skip?: number
      take?: number
      order?: Record<string, "ASC" | "DESC">
    }
  ) => Promise<[StoreProduct[], number]>
}

const PRODUCT_RELATIONS = [
  "collection",
  "tags",
  "images",
  "metadata",
  "variants",
  "variants.prices",
  "variants.options",
  "variants.options.option",
  "options",
  "options.values",
  "categories",
  "categories.parent_category",
  "categories.parent_category.parent_category",
]

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

const buildProductSlugParts = (product: StoreProduct): ProductSlug => {
  const meta = product.metadata as Record<string, unknown> | undefined
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
  const collectionTitle: string | null =
    typeof (product.collection as { title?: unknown } | undefined)?.title === "string"
      ? ((product.collection as { title?: unknown }).title as string)
      : null

  const parseFromTitle = (): { artist: string; album: string } => {
    if (title.includes(" - ")) {
      const [maybeArtistRaw, ...rest] = title.split(" - ")
      const maybeArtist = maybeArtistRaw?.trim() ?? ""
      const album = rest.join(" - ").trim()
      if (maybeArtist.length && album.length) {
        return { artist: maybeArtist, album }
      }
    }
    const fallback: string = collectionTitle ?? "Remorseless Records"
    return { artist: fallback, album: fallback }
  }

  const parsedTitle = parseFromTitle()
  const artist = metaArtist ?? parsedTitle.artist ?? "Remorseless Records"
  const album = metaAlbum ?? parsedTitle.album ?? artist

  const artistSlug = slugify(metaArtistSlug) ?? slugify(artist) ?? ""
  const albumSlug = slugify(metaAlbumSlug) ?? slugify(album) ?? ""

  return { artistSlug, albumSlug }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const handle = typeof req.params?.handle === "string" ? req.params.handle.trim() : null
  if (!handle) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Product handle is required")
  }

  const productModule = req.scope.resolve(Modules.PRODUCT) as ProductModule

  const [productList] = await productModule.listAndCountProducts(
    { handle },
    { relations: PRODUCT_RELATIONS, take: 1 }
  )

  const product = productList.at(0)
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${handle} not found`)
  }

  const seen = new Set<string>(product.id ? [product.id] : [])
  const suggestions: StoreProduct[] = []

  const append = (items: StoreProduct[] | undefined) => {
    items?.forEach((item) => {
      if (!item?.id || seen.has(item.id) || item.handle === product.handle) {
        return
      }
      seen.add(item.id)
      suggestions.push(item)
    })
  }

  const targetSlug = buildProductSlugParts(product)
  const collectionId =
    product.collection?.id ?? (product as { collection_id?: string }).collection_id ?? null

  if (collectionId) {
    const [fromCollection] = await productModule.listAndCountProducts(
      { collection_id: collectionId },
      { relations: PRODUCT_RELATIONS, take: 16 }
    )
    append(fromCollection)
  }

  const genreHandles =
    (product.categories ?? [])
      .map((category) => category.handle?.trim().toLowerCase())
      .filter((handle): handle is string => Boolean(handle)) ?? []
  const genreSet = new Set<string>(genreHandles.filter((h): h is string => Boolean(h)))

  const [recent] = await productModule.listAndCountProducts(
    {},
    { relations: PRODUCT_RELATIONS, take: 1000 }
  )

  const sameArtist: StoreProduct[] = []
  const genreMatches: StoreProduct[] = []
  const fallback: StoreProduct[] = []

  recent.forEach((candidate) => {
    if (!candidate?.id || seen.has(candidate.id) || candidate.handle === product.handle) {
      return
    }
    const slug = buildProductSlugParts(candidate)
    const candidateArtist = slug.artistSlug?.toLowerCase() ?? null
    const candidateGenres =
      candidate.categories?.map((category: { handle?: string | null }) =>
        category?.handle?.trim().toLowerCase()
      ) ?? []

    if (targetSlug.artistSlug && candidateArtist === targetSlug.artistSlug.toLowerCase()) {
      sameArtist.push(candidate)
      return
    }

    if (candidateGenres.some((handle) => handle && genreSet.has(handle))) {
      genreMatches.push(candidate)
      return
    }

    fallback.push(candidate)
  })

  sameArtist.forEach((item) => {
    if (!item.id || seen.has(item.id) || item.handle === product.handle) {
      return
    }
    seen.add(item.id)
    suggestions.push(item)
  })

  const MAX_SUGGESTIONS = 12
  const shuffle = <T,>(items: T[]): T[] => {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = copy[i] as T
      copy[i] = copy[j] as T
      copy[j] = temp
    }
    return copy
  }

  const fillFrom = (pool: StoreProduct[]) => {
    shuffle(pool).forEach((item) => {
      if (suggestions.length >= MAX_SUGGESTIONS) {
        return
      }
      if (!item?.id || seen.has(item.id) || item.handle === product.handle) {
        return
      }
      seen.add(item.id)
      suggestions.push(item)
    })
  }

  fillFrom(genreMatches)
  fillFrom(fallback)

  res.status(200).json({ products: suggestions.slice(0, MAX_SUGGESTIONS) })
}
