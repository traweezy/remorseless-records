import { unstable_cache } from "next/cache"
import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import { toProviderRequestError } from "@/lib/http/provider-boundary"
import { fetchObservedProviderRead } from "@/lib/http/provider-read.server"
import { buildPublicProductPath } from "@/lib/products/routes"

const DISCOGRAPHY_REVALIDATE_SECONDS = 60
const DISCOGRAPHY_MAX_PAGES = 25

export type DiscographyAvailability =
  | "in_print"
  | "out_of_print"
  | "preorder"
  | "digital_only"
  | "unknown"

export type DiscographyLinkHealth =
  | "healthy"
  | "missing"
  | "not_applicable"
  | "unknown"
  | "unpublished"

export type DiscographySourceMode = "catalog_product" | "manual"

export type DiscographyEntry = {
  id: string
  title: string
  artist: string
  album: string
  slug: {
    artist: string
    album: string
    artistSlug: string
    albumSlug: string
  }
  productHandle: string | null
  productPath: string | null
  sourceMode: DiscographySourceMode
  linkHealth: DiscographyLinkHealth
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  tags: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
  coverAltText: string | null
}

type DiscographyApiEntry = {
  id: string
  title: string
  artist: string
  album: string
  productHandle: string | null
  sourceMode: DiscographySourceMode
  linkHealth: DiscographyLinkHealth
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  tags: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
  coverAltText: string | null
}

const nullableDiscographyText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .nullable()
    .transform((value) => {
      const trimmed = value?.trim() ?? ""
      return trimmed.length > 0 ? trimmed : null
    })

const discographyApiEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    artist: z.string().max(500),
    album: z.string().max(500),
    productId: nullableDiscographyText(200).optional(),
    productHandle: nullableDiscographyText(200),
    sourceMode: z.enum(["catalog_product", "manual"]),
    linkHealth: z.enum([
      "healthy",
      "missing",
      "not_applicable",
      "unknown",
      "unpublished",
    ]),
    collectionTitle: nullableDiscographyText(500),
    catalogNumber: nullableDiscographyText(200),
    releaseDate: z.string().trim().datetime().nullable(),
    releaseYear: z.number().int().min(1000).max(9999).nullable(),
    formats: z.array(z.string().max(200)).max(100),
    genres: z.array(z.string().max(200)).max(100),
    tags: z.array(z.string().max(200)).max(100),
    availability: z.enum([
      "in_print",
      "out_of_print",
      "preorder",
      "digital_only",
      "unknown",
    ]),
    coverUrl: nullableDiscographyText(2_048),
    coverAltText: nullableDiscographyText(1_000),
    archivedAt: z.string().trim().datetime().nullable().optional(),
    lastSyncedAt: z.string().trim().datetime().nullable().optional(),
    version: z.number().int().min(1).max(1_000_000_000).optional(),
    createdAt: z.string().trim().datetime().nullable().optional(),
    updatedAt: z.string().trim().datetime().nullable().optional(),
  })
  .strict()

const discographyPageSchema = z
  .object({
    entries: z.array(discographyApiEntrySchema).max(200),
    count: z.number().int().min(0).max(1_000_000),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()

const parseDiscographyPage = (
  value: unknown,
  expected: { limit: number; offset: number }
): { entries: DiscographyApiEntry[]; count: number } => {
  const payload = discographyPageSchema.parse(value)
  const responseOffset = payload.offset ?? expected.offset
  const responseLimit = payload.limit ?? expected.limit
  if (
    responseOffset !== expected.offset ||
    responseLimit !== expected.limit ||
    payload.entries.length > responseLimit ||
    payload.count < responseOffset + payload.entries.length
  ) {
    throw new Error("Discography response pagination is inconsistent")
  }
  const ids = payload.entries.map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Discography response contains duplicate entries")
  }

  return {
    count: payload.count,
    entries: payload.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      album: entry.album,
      productHandle: entry.productHandle,
      sourceMode: entry.sourceMode,
      linkHealth: entry.linkHealth,
      collectionTitle: entry.collectionTitle,
      catalogNumber: entry.catalogNumber,
      releaseDate: entry.releaseDate,
      releaseYear: entry.releaseYear,
      formats: entry.formats,
      genres: entry.genres,
      tags: entry.tags,
      availability: entry.availability,
      coverUrl: entry.coverUrl,
      coverAltText: entry.coverAltText,
    })),
  }
}

const FORMAT_PATTERNS = [
  {
    label: "Vinyl",
    pattern:
      /(vinyl|lp|12"|12-inch|12 inch|10"|10-inch|10 inch|7"|7-inch|7 inch|record)/i,
  },
  {
    label: "CD",
    pattern: /(compact disc|\bcd\b)/i,
  },
  {
    label: "Cassette",
    pattern: /(cassette|tape|k7)/i,
  },
] as const

const normalizeFormats = (formats: string[] | null | undefined): string[] => {
  if (!formats?.length) {
    return []
  }

  const found = new Set<string>()

  formats.forEach((raw) => {
    if (typeof raw !== "string") {
      return
    }
    const normalized = raw.trim()
    if (!normalized.length) {
      return
    }

    for (const { label, pattern } of FORMAT_PATTERNS) {
      if (pattern.test(normalized)) {
        found.add(label)
        break
      }
    }
  })

  return FORMAT_PATTERNS.map(({ label }) => label).filter((label) =>
    found.has(label)
  )
}

const normalizeTags = (tags: string[] | null | undefined): string[] => {
  if (!tags?.length) {
    return []
  }

  const normalized: string[] = []
  const seen = new Set<string>()

  tags.forEach((raw) => {
    if (typeof raw !== "string") {
      return
    }

    const trimmed = raw.trim()
    if (!trimmed.length) {
      return
    }

    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    normalized.push(trimmed)
  })

  return normalized
}

const removeDiacritics = (value: string): string =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")

const slugifySegment = (value: string): string => {
  const sanitized = removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")

  return sanitized.length > 0 ? sanitized : "release"
}

const buildSlugParts = (
  artist: string,
  album: string
): DiscographyEntry["slug"] => {
  const trimmedArtist = artist.trim()
  const trimmedAlbum = album.trim()
  const safeArtist =
    trimmedArtist !== ""
      ? trimmedArtist
      : trimmedAlbum !== ""
        ? trimmedAlbum
        : "Remorseless Records"
  const safeAlbum =
    trimmedAlbum !== ""
      ? trimmedAlbum
      : trimmedArtist !== ""
        ? trimmedArtist
        : safeArtist

  return {
    artist: safeArtist,
    album: safeAlbum,
    artistSlug: slugifySegment(safeArtist),
    albumSlug: slugifySegment(safeAlbum),
  }
}

const normalizeEntry = (entry: DiscographyApiEntry): DiscographyEntry => {
  const slug = buildSlugParts(entry.artist, entry.album)
  const trimmedHandle = entry.productHandle?.trim() ?? ""
  const productHandle = trimmedHandle !== "" ? trimmedHandle : null
  const productPath =
    entry.sourceMode === "catalog_product" &&
    entry.linkHealth === "healthy" &&
    productHandle
      ? buildPublicProductPath({
          handle: productHandle,
          productType: "Music release",
        })
      : null

  const releaseYear =
    entry.releaseYear ??
    (entry.releaseDate ? new Date(entry.releaseDate).getUTCFullYear() : null)

  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    slug,
    productHandle,
    productPath,
    sourceMode: entry.sourceMode,
    linkHealth: entry.linkHealth,
    collectionTitle: entry.collectionTitle ?? null,
    catalogNumber: entry.catalogNumber ?? null,
    releaseDate: entry.releaseDate ?? null,
    releaseYear: Number.isFinite(releaseYear ?? NaN) ? releaseYear : null,
    formats: normalizeFormats(entry.formats ?? []),
    genres: entry.genres ?? [],
    tags: normalizeTags(entry.tags ?? []),
    availability: entry.availability ?? "unknown",
    coverUrl: entry.coverUrl ?? null,
    coverAltText: entry.coverAltText ?? null,
  }
}

const fetchDiscographyEntries = async (): Promise<DiscographyEntry[]> => {
  if (!runtimeEnv.medusaBackendUrl || !runtimeEnv.medusaPublishableKey) {
    console.error("[discography] Missing Medusa configuration")
    return []
  }

  try {
    const collected: DiscographyApiEntry[] = []
    const limit = 200
    let offset = 0
    let total: number | null = null

    for (let page = 0; page < DISCOGRAPHY_MAX_PAGES; page += 1) {
      const url = new URL("/store/discography", runtimeEnv.medusaBackendUrl)
      url.searchParams.set("limit", String(limit))
      url.searchParams.set("offset", String(offset))

      const response = await fetchObservedProviderRead(url.toString(), {
        headers: {
          "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
        },
        next: {
          revalidate: DISCOGRAPHY_REVALIDATE_SECONDS,
          tags: ["discography"],
        },
      })

      if (!response.ok) {
        console.error("[discography] Failed to fetch entries", response.status)
        return []
      }

      const rawPayload: unknown = await response.json()
      const payload = parseDiscographyPage(rawPayload, { limit, offset })
      const entries = payload.entries
      const existingIds = new Set(collected.map((entry) => entry.id))
      if (entries.some((entry) => existingIds.has(entry.id))) {
        throw new Error("Discography response repeated an entry")
      }
      collected.push(...entries)
      if (total !== null && payload.count !== total) {
        throw new Error("Discography response changed its total count")
      }
      total = payload.count
      offset += entries.length

      if (!entries.length || (total !== null && offset >= total)) {
        return collected.map(normalizeEntry)
      }
    }

    console.error("[discography] Reached the provider pagination ceiling")
    return []
  } catch (error) {
    console.error("[discography] Failed to load discography", {
      failure: toProviderRequestError(error).kind,
    })
    return []
  }
}

export const getDiscographyEntries = unstable_cache(
  fetchDiscographyEntries,
  ["discography-entries"],
  {
    revalidate: DISCOGRAPHY_REVALIDATE_SECONDS,
    tags: ["discography"],
  }
)
