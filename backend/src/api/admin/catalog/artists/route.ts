import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { serializeCatalogArtist } from "@/modules/catalog/serializers"
import {
  coerceJsonRecord,
  resolveUniqueSlug,
  slugify,
  toNullableString,
  type CatalogService,
} from "../utils"

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(["name", "sort_name", "created_at", "updated_at"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
})

const artistCreateSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional().nullable(),
  sortName: z.string().trim().optional().nullable(),
  imageUrl: z.string().trim().url().optional().nullable(),
  bio: z.string().trim().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { q, limit, offset, order, direction } = listQuerySchema.parse(req.query)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const take = limit ?? 100
  const skip = offset ?? 0
  const sortField = order ?? "name"
  const sortDirection = (direction ?? "asc").toUpperCase() as "ASC" | "DESC"

  const [rawArtists, rawCount] = await catalogService.listAndCountCatalogArtists(
    {},
    {
      skip: q ? 0 : skip,
      take: q ? Math.max(take + skip, 500) : take,
      order: { [sortField]: sortDirection },
    }
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
  const createdResult = await catalogService.createCatalogArtists([
    {
      name: parsed.data.name.trim(),
      slug,
      sort_name: toNullableString(parsed.data.sortName),
      image_url: toNullableString(parsed.data.imageUrl),
      bio: toNullableString(parsed.data.bio),
      location: toNullableString(parsed.data.location),
      metadata: coerceJsonRecord(parsed.data.metadata),
    },
  ])
  const created = Array.isArray(createdResult)
    ? createdResult[0]
    : createdResult

  if (!created) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create catalog artist"
    )
  }

  res.status(201).json({ artist: serializeCatalogArtist(created) })
}
