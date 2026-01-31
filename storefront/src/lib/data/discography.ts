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
    formats: entry.formats ?? [],
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
    const url = new URL("/store/discography", runtimeEnv.medusaBackendUrl)
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

    const payload = (await response.json()) as { entries?: DiscographyApiEntry[] }
    const entries = payload.entries ?? []

    return entries.map(normalizeEntry)
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
