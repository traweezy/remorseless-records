import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  readCatalogArtistMutation,
  readCatalogArtistPage,
} from "@/lib/catalog/profile-persistence-contracts"
import { serializeCatalogArtist } from "@/modules/catalog/serializers"
import {
  coerceJsonRecord,
  resolveUniqueSlug,
  slugify,
  toNullableString,
  type CatalogService,
} from "../utils"

const httpUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol)
    } catch {
      return false
    }
  })

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(["name", "sort_name", "created_at", "updated_at"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
})

const artistCreateSchema = z.object({
  name: z.string().trim().min(1).max(500),
  slug: z.string().trim().max(255).optional().nullable(),
  sortName: z.string().trim().max(500).optional().nullable(),
  imageUrl: httpUrlSchema.optional().nullable(),
  bio: z.string().trim().max(50_000).optional().nullable(),
  location: z.string().trim().max(500).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { q, limit, offset, order, direction } = listQuerySchema.parse(
    req.query
  )
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const take = limit ?? 100
  const skip = offset ?? 0
  const sortField = order ?? "name"
  const sortDirection = (direction ?? "asc").toUpperCase() as "ASC" | "DESC"

  const { count: rawCount, records: rawArtists } = readCatalogArtistPage(
    await catalogService.listAndCountCatalogArtists(
      {},
      {
        skip: q ? 0 : skip,
        take: q ? 500 : take,
        order: { [sortField]: sortDirection },
      }
    ),
    q ? 500 : take
  )

  const needle = q?.toLowerCase() ?? null
  const artists = needle
    ? rawArtists.filter((artist) => {
        const name = artist.name?.toLowerCase() ?? ""
        const slug = artist.slug?.toLowerCase() ?? ""
        const sortName = artist.sort_name?.toLowerCase() ?? ""
        return (
          name.includes(needle) ||
          slug.includes(needle) ||
          sortName.includes(needle)
        )
      })
    : rawArtists
  const count = needle ? artists.length : rawCount

  res.status(200).json({
    artists: artists.slice(skip, skip + take).map(serializeCatalogArtist),
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = artistCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog artist payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const baseSlug = slugify(parsed.data.slug ?? parsed.data.name, "artist")
  const slug = await resolveUniqueSlug(catalogService, baseSlug)
  const payload = {
    bio: toNullableString(parsed.data.bio),
    image_url: toNullableString(parsed.data.imageUrl),
    location: toNullableString(parsed.data.location),
    metadata: coerceJsonRecord(parsed.data.metadata),
    name: parsed.data.name.trim(),
    slug,
    sort_name: toNullableString(parsed.data.sortName),
  }
  const created = readCatalogArtistMutation(
    await catalogService.createCatalogArtists([payload]),
    { fields: payload }
  )

  res.status(201).json({ artist: serializeCatalogArtist(created) })
}
