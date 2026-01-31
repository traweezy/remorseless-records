import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type DiscographyModuleService from "@/modules/discography/service"
import {
  discographyAvailabilityValues,
  serializeDiscographyEntry,
} from "@/modules/discography/serializers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z
    .enum(["release_date", "release_year", "created_at", "title"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
})

const entryBaseSchema = z.object({
  title: z.string().trim().min(1),
  artist: z.string().trim().min(1),
  album: z.string().trim().min(1),
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

const normalizeList = (values?: string[]): string[] =>
  (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)

const toNullableString = (value: string | null | undefined): string | null =>
  value && value.trim().length ? value.trim() : null

const toEntryPayload = (input: z.infer<typeof entryBaseSchema>) => ({
  title: input.title.trim(),
  artist: input.artist.trim(),
  album: input.album.trim(),
  product_handle: toNullableString(input.productHandle),
  collection_title: toNullableString(input.collectionTitle),
  catalog_number: toNullableString(input.catalogNumber),
  release_date: toOptionalDate(input.releaseDate),
  release_year: input.releaseYear ?? null,
  formats: normalizeList(input.formats),
  genres: normalizeList(input.genres),
  availability: input.availability ?? "unknown",
  cover_url: toNullableString(input.coverUrl),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { limit, offset, order, direction } = listQuerySchema.parse(req.query)
  const discographyService = req.scope.resolve("discography") as DiscographyService

  const take = limit ?? 100
  const skip = offset ?? 0
  const sortField = order ?? "release_year"
  const sortDirection = (direction ?? "desc").toUpperCase() as "ASC" | "DESC"

  const [entries, count] = await discographyService.listAndCountDiscographyEntries(
    {},
    {
      skip,
      take,
      order: { [sortField]: sortDirection },
    }
  )

  res.status(200).json({
    entries: entries.map(serializeDiscographyEntry),
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = entryBaseSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography payload"
    )
  }

  const discographyService = req.scope.resolve("discography") as DiscographyService
  const createdResult = await discographyService.createDiscographyEntries([
    toEntryPayload(parsed.data),
  ])
  const created = Array.isArray(createdResult)
    ? createdResult[0]
    : createdResult

  if (!created) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create discography entry"
    )
  }

  res.status(201).json({ entry: serializeDiscographyEntry(created) })
}
