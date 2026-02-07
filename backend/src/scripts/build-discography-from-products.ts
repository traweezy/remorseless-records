import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import type DiscographyModuleService from "@/modules/discography/service"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

type ProductCategory = {
  name?: string | null
  handle?: string | null
  parent_category?: ProductCategory | null
}

type ProductCollection = {
  title?: string | null
}

type ProductImage = {
  url?: string | null
}

type ProductVariant = {
  title?: string | null
  allow_backorder?: boolean | null
  manage_inventory?: boolean | null
  inventory_quantity?: number | null
}

type ProductOptionValue = {
  value?: string | null
}

type ProductOption = {
  title?: string | null
  values?: ProductOptionValue[] | null
}

type ProductRecord = {
  id?: string | null
  handle?: string | null
  title?: string | null
  subtitle?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  categories?: ProductCategory[] | null
  collection?: ProductCollection | null
  thumbnail?: string | null
  images?: ProductImage[] | null
  variants?: ProductVariant[] | null
  options?: ProductOption[] | null
}

type ProductService = {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: {
      relations?: string[]
      skip?: number
      take?: number
    }
  ) => Promise<[ProductRecord[], number]>
}

type DiscographyEntryRecord = {
  id?: string
  product_handle?: string | null
}

type DiscographyCreatePayload = {
  title: string
  artist: string
  album: string
  product_handle: string | null
  collection_title: string | null
  catalog_number: string | null
  release_date: Date | null
  release_year: number | null
  formats: string[]
  genres: string[]
  availability: "in_print" | "out_of_print" | "preorder" | "digital_only" | "unknown"
  cover_url: string | null
}

const PRODUCT_RELATIONS = [
  "collection",
  "categories",
  "categories.parent_category",
  "categories.parent_category.parent_category",
  "images",
  "variants",
  "options",
  "options.values",
]

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const coerceRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const normalizeHandle = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

const humanizeHandle = (handle: string): string =>
  handle
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")

const collectAncestors = (category: ProductCategory | null | undefined): ProductCategory[] => {
  const ancestors: ProductCategory[] = []
  let current: ProductCategory | null | undefined = category
  let guard = 0

  while (current && guard < 16) {
    ancestors.push(current)
    current = current.parent_category ?? null
    guard += 1
  }

  return ancestors
}

const findRootCategory = (category: ProductCategory | null | undefined): ProductCategory | null => {
  const ancestors = collectAncestors(category)
  return ancestors.length ? ancestors[ancestors.length - 1] ?? null : null
}

const findArtistCategory = (
  categories: ProductCategory[] | null | undefined
): { name: string; handle: string } | null => {
  if (!categories?.length) {
    return null
  }

  for (const category of categories) {
    let current: ProductCategory | null | undefined = category
    let hasArtistAncestor = false

    while (current) {
      const handle = normalizeHandle(current.handle)
      if (handle === "artists") {
        hasArtistAncestor = true
        break
      }
      current = current.parent_category ?? null
    }

    if (!hasArtistAncestor) {
      continue
    }

    const handle = normalizeHandle(category.handle)
    if (!handle) {
      continue
    }

    const name = normalizeString(category.name) ?? humanizeHandle(handle)
    return { name, handle }
  }

  return null
}

const GENRE_ROOT_HANDLES = new Set(["genres", "metal", "death", "doom", "grind", "sludge"])

const extractGenres = (categories: ProductCategory[] | null | undefined): string[] => {
  if (!categories?.length) {
    return []
  }

  const genres = new Map<string, string>()

  for (const category of categories) {
    const handle = normalizeHandle(category.handle)
    if (!handle || handle === "artists") {
      continue
    }

    const root = findRootCategory(category)
    const rootHandle = normalizeHandle(root?.handle)
    if (!rootHandle || rootHandle === "artists") {
      continue
    }

    if (!GENRE_ROOT_HANDLES.has(rootHandle) && !GENRE_ROOT_HANDLES.has(handle)) {
      continue
    }

    const label = normalizeString(category.name) ?? humanizeHandle(handle)
    genres.set(handle, label)
  }

  return Array.from(genres.values())
}

const extractMetadataString = (metadata: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!metadata) {
    return null
  }

  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed.length) {
        return trimmed
      }
    }
  }

  return null
}

const extractMetadataNumber = (metadata: Record<string, unknown> | null, keys: string[]): number | null => {
  if (!metadata) {
    return null
  }

  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value)
    }
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed.length) {
        continue
      }
      const parsed = Number.parseInt(trimmed, 10)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }
  }

  return null
}

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const normalizeFormat = (value: string | null | undefined): string | null => {
  const trimmed = normalizeString(value)
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null
  }
  return trimmed
}

const extractFormats = (product: ProductRecord): string[] => {
  const formats = new Set<string>()

  const add = (value: string | null | undefined) => {
    const normalized = normalizeFormat(value)
    if (normalized) {
      formats.add(normalized)
    }
  }

  product.variants?.forEach((variant) => add(variant?.title))

  product.options
    ?.find((option) => option?.title?.toLowerCase() === "format")
    ?.values?.forEach((entry) => add(entry?.value))

  const metadata = coerceRecord(product.metadata)
  if (metadata) {
    add(typeof metadata.format === "string" ? metadata.format : null)
    add(typeof metadata.packaging === "string" ? metadata.packaging : null)

    const rawFormats = metadata.formats
    if (Array.isArray(rawFormats)) {
      rawFormats.forEach((entry) => {
        if (typeof entry === "string") {
          add(entry)
        }
      })
    }
  }

  return Array.from(formats.values())
}

const resolveAvailability = (product: ProductRecord): DiscographyCreatePayload["availability"] => {
  const status = normalizeString(product.status)?.toLowerCase() ?? null
  if (status && status !== "published") {
    return "unknown"
  }

  const variants = product.variants ?? []
  if (!variants.length) {
    return "unknown"
  }

  const inStock = variants.some((variant) => {
    if (!variant) {
      return false
    }
    if (variant.allow_backorder) {
      return true
    }
    const manageInventory =
      typeof variant.manage_inventory === "boolean" ? variant.manage_inventory : null
    const qty =
      typeof variant.inventory_quantity === "number" ? variant.inventory_quantity : null
    if (manageInventory === false) {
      return true
    }
    if (typeof qty === "number") {
      return qty > 0
    }
    return false
  })

  return inStock ? "in_print" : "out_of_print"
}

const resolveArtistAlbum = (product: ProductRecord) => {
  const metadata = coerceRecord(product.metadata)

  const metaArtist = extractMetadataString(metadata, [
    "artist",
    "Artist",
    "artist_name",
    "artistName",
  ])
  const metaAlbum = extractMetadataString(metadata, [
    "album",
    "Album",
    "release",
    "release_title",
    "releaseTitle",
  ])

  const title = normalizeString(product.title) ?? ""
  const collectionTitle = normalizeString(product.collection?.title)
  const artistCategory = findArtistCategory(product.categories ?? null)

  const parseFromTitle = () => {
    if (title.includes(" - ")) {
      const [maybeArtistRaw, ...rest] = title.split(" - ")
      const artist = maybeArtistRaw?.trim() ?? ""
      const album = rest.join(" - ").trim()
      if (artist.length && album.length) {
        return { artist, album }
      }
    }
    const fallback = collectionTitle ?? "Remorseless Records"
    return { artist: fallback, album: fallback }
  }

  const parsed = parseFromTitle()
  const artist =
    metaArtist ??
    normalizeString(artistCategory?.name) ??
    parsed.artist ??
    "Remorseless Records"
  const album = metaAlbum ?? parsed.album ?? artist

  return { artist, album }
}

const buildPayload = (product: ProductRecord): DiscographyCreatePayload | null => {
  const handle = normalizeString(product.handle)
  if (!handle) {
    return null
  }

  const { artist, album } = resolveArtistAlbum(product)
  const title = normalizeString(product.title) ?? album ?? handle

  const metadata = coerceRecord(product.metadata)
  const collectionTitle = normalizeString(product.collection?.title)
  const catalogNumber =
    extractMetadataString(metadata, ["catalog_number", "catalogNumber", "catalog", "cat_no"]) ??
    null

  const releaseDate =
    parseDate(
      extractMetadataString(metadata, [
        "release_date",
        "releaseDate",
        "released_at",
        "releasedAt",
        "release",
      ])
    ) ?? null

  const releaseYear =
    extractMetadataNumber(metadata, ["release_year", "releaseYear", "year"]) ??
    (releaseDate ? releaseDate.getFullYear() : null)

  const formats = extractFormats(product)
  const genres = extractGenres(product.categories ?? null)
  const availability = resolveAvailability(product)
  const coverUrl =
    normalizeString(product.thumbnail) ??
    normalizeString(product.images?.find((image) => image?.url)?.url) ??
    null

  return {
    title,
    artist,
    album,
    product_handle: handle,
    collection_title: collectionTitle ?? null,
    catalog_number: catalogNumber,
    release_date: releaseDate,
    release_year: releaseYear,
    formats,
    genres,
    availability,
    cover_url: coverUrl,
  }
}

const listAll = async <T>(
  fetchPage: (skip: number, take: number) => Promise<[T[], number]>
): Promise<T[]> => {
  const results: T[] = []
  const take = 200
  let skip = 0

  while (true) {
    const [items, count] = await fetchPage(skip, take)
    results.push(...items)
    skip += items.length
    if (!items.length || skip >= count) {
      break
    }
  }

  return results
}

export default async function buildDiscographyFromProducts({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT) as ProductService
  const discographyService = container.resolve("discography") as DiscographyService

  const existingEntries = await listAll<DiscographyEntryRecord>((skip, take) =>
    discographyService.listAndCountDiscographyEntries(
      {},
      { skip, take }
    )
  )
  const existingByHandle = new Set(
    existingEntries
      .map((entry) => normalizeString(entry.product_handle))
      .filter((handle): handle is string => Boolean(handle))
  )

  const products = await listAll<ProductRecord>((skip, take) =>
    productService.listAndCountProducts(
      {},
      {
        relations: PRODUCT_RELATIONS,
        skip,
        take,
      }
    )
  )

  const toCreate: DiscographyCreatePayload[] = []
  let skippedExisting = 0
  let skippedMissing = 0

  products.forEach((product) => {
    const handle = normalizeString(product.handle)
    if (!handle) {
      skippedMissing += 1
      return
    }
    if (existingByHandle.has(handle)) {
      skippedExisting += 1
      return
    }

    const payload = buildPayload(product)
    if (!payload) {
      skippedMissing += 1
      return
    }
    toCreate.push(payload)
  })

  const batchSize = 50
  let created = 0

  for (let i = 0; i < toCreate.length; i += batchSize) {
    const batch = toCreate.slice(i, i + batchSize)
    if (!batch.length) {
      continue
    }
    await discographyService.createDiscographyEntries(batch)
    created += batch.length
  }

  logger.info(
    `[discography] Scanned ${products.length} products. Created ${created} entries. Skipped ${skippedExisting} existing, ${skippedMissing} missing handles.`
  )
}
