import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type DiscographyModuleService from "@/modules/discography/service"
import {
  discographyAvailabilityValues,
  serializeDiscographyEntry,
} from "@/modules/discography/serializers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

const entryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  artist: z.string().trim().min(1).optional(),
  album: z.string().trim().min(1).optional(),
  productHandle: z.string().trim().optional().nullable(),
  collectionTitle: z.string().trim().optional().nullable(),
  catalogNumber: z.string().trim().optional().nullable(),
  releaseDate: z.string().trim().optional().nullable(),
  releaseYear: z.coerce.number().int().optional().nullable(),
  formats: z.array(z.string().trim()).optional(),
  genres: z.array(z.string().trim()).optional(),
  availability: z.enum(discographyAvailabilityValues).optional(),
  coverUrl: z.string().trim().url().optional().nullable(),
})

const toOptionalDate = (value: string | null | undefined): Date | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const normalizeList = (values?: string[]): string[] | undefined => {
  if (!values) {
    return undefined
  }
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return normalized
}

const toNullableString = (value: string | null | undefined): string | null =>
  value && value.trim().length ? value.trim() : null

const toUpdatePayload = (input: z.infer<typeof entryUpdateSchema>) => {
  const payload: Record<string, unknown> = {}

  if (input.title !== undefined) payload.title = input.title.trim()
  if (input.artist !== undefined) payload.artist = input.artist.trim()
  if (input.album !== undefined) payload.album = input.album.trim()
  if (input.productHandle !== undefined) {
    payload.product_handle = toNullableString(input.productHandle)
  }
  if (input.collectionTitle !== undefined) {
    payload.collection_title = toNullableString(input.collectionTitle)
  }
  if (input.catalogNumber !== undefined) {
    payload.catalog_number = toNullableString(input.catalogNumber)
  }
  if (input.releaseDate !== undefined) {
    payload.release_date = toOptionalDate(input.releaseDate)
  }
  if (input.releaseYear !== undefined) {
    payload.release_year = input.releaseYear ?? null
  }
  if (input.formats !== undefined) {
    payload.formats = normalizeList(input.formats)
  }
  if (input.genres !== undefined) {
    payload.genres = normalizeList(input.genres)
  }
  if (input.availability !== undefined) {
    payload.availability = input.availability
  }
  if (input.coverUrl !== undefined) {
    payload.cover_url = toNullableString(input.coverUrl)
  }

  return payload
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }
  const discographyService = req.scope.resolve("discography") as DiscographyService
  const entry = await discographyService.retrieveDiscographyEntry(id)

  if (!entry) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Discography entry not found"
    )
  }

  res.status(200).json({ entry: serializeDiscographyEntry(entry) })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = entryUpdateSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography payload"
    )
  }

  const payload = toUpdatePayload(parsed.data)
  if (!Object.keys(payload).length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No updates provided"
    )
  }

  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }

  const discographyService = req.scope.resolve("discography") as DiscographyService
  const updatedResult = await discographyService.updateDiscographyEntries([
    {
      id,
      ...payload,
    },
  ])
  const updated = Array.isArray(updatedResult)
    ? updatedResult[0]
    : updatedResult

  if (!updated) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Discography entry not found"
    )
  }

  res.status(200).json({ entry: serializeDiscographyEntry(updated) })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }
  const discographyService = req.scope.resolve("discography") as DiscographyService
  await discographyService.deleteDiscographyEntries(id)
  res.sendStatus(204)
}
