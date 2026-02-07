import { unstable_cache } from "next/cache"

import { runtimeEnv } from "@/config/env"

export type DiscographyAvailability =
  | "in_print"
  | "out_of_print"
  | "preorder"
  | "digital_only"
  | "unknown"

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
  productPath: string
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
}

type DiscographyApiEntry = {
  id: string
  title: string
  artist: string
  album: string
  productHandle: string | null
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
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

  return FORMAT_PATTERNS.map(({ label }) => label).filter((label) => found.has(label))
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
  const productPath = productHandle
    ? `/products/${productHandle}`
    : `/products/${slug.artistSlug}-${slug.albumSlug}`

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
    collectionTitle: entry.collectionTitle ?? null,
    catalogNumber: entry.catalogNumber ?? null,
    releaseDate: entry.releaseDate ?? null,
    releaseYear: Number.isFinite(releaseYear ?? NaN) ? releaseYear : null,
    formats: normalizeFormats(entry.formats ?? []),
    genres: entry.genres ?? [],
    availability: entry.availability ?? "unknown",
    coverUrl: entry.coverUrl ?? null,
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

    while (true) {
      const url = new URL("/store/discography", runtimeEnv.medusaBackendUrl)
      url.searchParams.set("limit", String(limit))
      url.searchParams.set("offset", String(offset))

      const response = await fetch(url.toString(), {
        headers: {
          "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
        },
        next: { revalidate: 900, tags: ["discography"] },
      })

      if (!response.ok) {
        console.error("[discography] Failed to fetch entries", response.status)
        return []
      }

      const payload = (await response.json()) as {
        entries?: DiscographyApiEntry[]
        count?: number
      }
      const entries = payload.entries ?? []
      collected.push(...entries)
      total = typeof payload.count === "number" ? payload.count : total
      offset += entries.length

      if (!entries.length || (total !== null && offset >= total)) {
        break
      }
    }

    return collected.map(normalizeEntry)
  } catch (error) {
    console.error("[discography] Failed to load discography", error)
    return []
  }
}

export const getDiscographyEntries = unstable_cache(
  fetchDiscographyEntries,
  ["discography-entries"],
  { revalidate: 900, tags: ["discography"] }
)
