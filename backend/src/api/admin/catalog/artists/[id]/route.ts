import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { rejectCatalogHardDeletion } from "@/lib/catalog/hard-deletion"
import {
  readCatalogArtist,
  readCatalogArtistMutation,
} from "@/lib/catalog/profile-persistence-contracts"
import { serializeCatalogArtist } from "@/modules/catalog/serializers"
import {
  coerceJsonRecord,
  resolveUniqueSlug,
  slugify,
  toNullableString,
  type CatalogService,
} from "../../utils"

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

const artistUpdateSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
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
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog artist id is required"
    )
  }

  const catalogService = req.scope.resolve<CatalogService>("catalog")
  const artist = readCatalogArtist(
    await catalogService.retrieveCatalogArtist(id),
    id
  )
  if (!artist) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog artist not found"
    )
  }

  res.status(200).json({ artist: serializeCatalogArtist(artist) })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = artistUpdateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog artist payload"
    )
  }
  if (!Object.keys(parsed.data).length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "No updates provided")
  }

  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog artist id is required"
    )
  }

  const catalogService = req.scope.resolve<CatalogService>("catalog")
  const existing = readCatalogArtist(
    await catalogService.retrieveCatalogArtist(id),
    id
  )
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog artist not found"
    )
  }

  const payload: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) {
    payload.name = parsed.data.name.trim()
  }
  if (parsed.data.slug !== undefined) {
    const baseSlug = slugify(
      parsed.data.slug ?? parsed.data.name ?? existing.name,
      "artist"
    )
    payload.slug = await resolveUniqueSlug(catalogService, baseSlug, id)
  }
  if (parsed.data.sortName !== undefined) {
    payload.sort_name = toNullableString(parsed.data.sortName)
  }
  if (parsed.data.imageUrl !== undefined) {
    payload.image_url = toNullableString(parsed.data.imageUrl)
  }
  if (parsed.data.bio !== undefined) {
    payload.bio = toNullableString(parsed.data.bio)
  }
  if (parsed.data.location !== undefined) {
    payload.location = toNullableString(parsed.data.location)
  }
  if (parsed.data.metadata !== undefined) {
    payload.metadata = coerceJsonRecord(parsed.data.metadata)
  }

  const updated = readCatalogArtistMutation(
    await catalogService.updateCatalogArtists([{ id, ...payload }]),
    { fields: payload, id }
  )

  res.status(200).json({ artist: serializeCatalogArtist(updated) })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => rejectCatalogHardDeletion(req, res, "catalog artists")
