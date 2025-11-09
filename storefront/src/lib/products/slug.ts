import type { HttpTypes } from "@medusajs/types"

type MaybeRecord = Record<string, unknown> | null | undefined

type SlugSource = {
  title?: string | null
  metadata?: MaybeRecord
  collectionTitle?: string | null
  handle?: string | null
}

export type ProductSlug = {
  artist: string
  album: string
  artistSlug: string
  albumSlug: string
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

const coerceString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  return null
}

const parseArtistAlbumFromTitle = (
  title: string,
  fallbackCollection?: string | null
): { artist: string; album: string } => {
  if (!title.trim()) {
    const fallback = fallbackCollection?.trim() ?? "Remorseless Records"
    return { artist: fallback, album: fallback }
  }

  let working = title.trim()
  const lastSeparator = working.lastIndexOf(" - ")

  if (lastSeparator !== -1) {
    const suffix = working.slice(lastSeparator + 3).trim()
    if (/^(cd|mc|lp|cassette|vinyl|2lp|3lp|7"|tape|digital|bundle|box)/i.test(suffix)) {
      working = working.slice(0, lastSeparator).trim()
    }
  }

  const firstSeparator = working.indexOf(" - ")

  if (firstSeparator === -1) {
    const fallbackArtist = fallbackCollection?.trim()
    return {
      artist: fallbackArtist ?? working,
      album: working,
    }
  }

  const artistSegment = working.slice(0, firstSeparator).trim()
  const albumSegment = working.slice(firstSeparator + 3).trim()

  const artist = artistSegment.length ? artistSegment : fallbackCollection?.trim() ?? working
  const album = albumSegment.length ? albumSegment : working

  return { artist, album }
}

const resolveMetadata = (metadata: MaybeRecord): MaybeRecord =>
  metadata && typeof metadata === "object" ? metadata : null

const parseArtistAlbumFromHandle = (
  handle: string
): { artist: string; album: string } => {
  const cleaned = handle.replace(/_/g, "-")
  const parts = cleaned
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const [first, ...rest] = parts

  if (!first) {
    return { artist: handle, album: handle }
  }

  if (rest.length === 0) {
    return { artist: first, album: first }
  }

  return {
    artist: first,
    album: rest.join(" "),
  }
}

export const buildProductSlugParts = (
  source: SlugSource | HttpTypes.StoreProduct
): ProductSlug => {
  const title =
    "title" in source
      ? coerceString(source.title)
      : coerceString((source as { title?: string }).title)

  const metadata =
    "metadata" in source
      ? resolveMetadata(source.metadata)
      : resolveMetadata((source as { metadata?: MaybeRecord }).metadata)

  const collectionTitle =
    "collectionTitle" in source
      ? coerceString(source.collectionTitle)
      : coerceString(
          ((source as HttpTypes.StoreProduct).collection as { title?: unknown } | undefined)?.title
        )

  const handle =
    "handle" in source
      ? coerceString(source.handle)
      : coerceString((source as { handle?: string }).handle)

  const metaArtist =
    coerceString(metadata?.artist) ??
    coerceString(metadata?.Artist) ??
    coerceString(metadata?.artist_name)

  const metaAlbum =
    coerceString(metadata?.album) ??
    coerceString(metadata?.Album) ??
    coerceString(metadata?.release)

  const metaArtistSlug = coerceString(
    metadata?.artist_slug ?? metadata?.artistSlug ?? metadata?.artistSlug
  )
  const metaAlbumSlug = coerceString(
    metadata?.album_slug ?? metadata?.albumSlug ?? metadata?.albumSlug
  )

  const { artist, album } = (() => {
    if (metaArtist && metaAlbum) {
      return { artist: metaArtist, album: metaAlbum }
    }
    if (title) {
      return parseArtistAlbumFromTitle(title, collectionTitle)
    }
    if (handle) {
      return parseArtistAlbumFromHandle(handle)
    }
    const fallback = collectionTitle ?? "Remorseless Records"
    return { artist: fallback, album: fallback }
  })()

  return {
    artist,
    album,
    artistSlug: metaArtistSlug ? slugifySegment(metaArtistSlug) : slugifySegment(artist),
    albumSlug: metaAlbumSlug ? slugifySegment(metaAlbumSlug) : slugifySegment(album),
  }
}

export const matchesProductSlug = (
  source: SlugSource | HttpTypes.StoreProduct,
  artistSlug: string,
  albumSlug: string
): boolean => {
  const slug = buildProductSlugParts(source)
  return slug.artistSlug === artistSlug && slug.albumSlug === albumSlug
}

export const decodeSlugSegment = (segment: string): string =>
  segment.replace(/-/g, " ").trim()
