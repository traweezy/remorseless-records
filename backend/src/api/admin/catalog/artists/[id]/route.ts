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
} from "../../utils"

const artistUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
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
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog artist id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const artist = await catalogService.retrieveCatalogArtist(id)
  if (!artist) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Catalog artist not found")
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

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const existing = await catalogService.retrieveCatalogArtist(id)
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Catalog artist not found")
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

  const updatedResult = await catalogService.updateCatalogArtists([
    { id, ...payload },
  ])
  const updated = Array.isArray(updatedResult)
    ? updatedResult[0]
    : updatedResult
  if (!updated) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Catalog artist not found")
  }

  res.status(200).json({ artist: serializeCatalogArtist(updated) })
}

export const DELETE = async (
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

  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.deleteCatalogArtists(id)
  res.sendStatus(204)
}
