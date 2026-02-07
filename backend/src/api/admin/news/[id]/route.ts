import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type NewsModuleService from "@/modules/news/service"
import {
  newsStatusValues,
  serializeNewsEntry,
} from "@/modules/news/serializers"

type NewsService = InstanceType<typeof NewsModuleService>

const entryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  excerpt: z.string().trim().optional().nullable(),
  content: z.string().trim().min(1).optional(),
  author: z.string().trim().optional().nullable(),
  status: z.enum(newsStatusValues).optional(),
  publishedAt: z.string().trim().optional().nullable(),
  tags: z.array(z.string().trim()).optional(),
  coverUrl: z.string().trim().url().optional().nullable(),
  seoTitle: z.string().trim().optional().nullable(),
  seoDescription: z.string().trim().optional().nullable(),
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
  if (input.slug !== undefined) payload.slug = input.slug.trim()
  if (input.excerpt !== undefined) {
    payload.excerpt = toNullableString(input.excerpt)
  }
  if (input.content !== undefined) payload.content = input.content.trim()
  if (input.author !== undefined) {
    payload.author = toNullableString(input.author)
  }
  if (input.status !== undefined) {
    payload.status = input.status
  }
  if (input.publishedAt !== undefined) {
    payload.published_at = toOptionalDate(input.publishedAt)
  }
  if (input.status === "published" && input.publishedAt === undefined) {
    payload.published_at = new Date()
  }
  if (input.tags !== undefined) {
    payload.tags = normalizeList(input.tags)
  }
  if (input.coverUrl !== undefined) {
    payload.cover_url = toNullableString(input.coverUrl)
  }
  if (input.seoTitle !== undefined) {
    payload.seo_title = toNullableString(input.seoTitle)
  }
  if (input.seoDescription !== undefined) {
    payload.seo_description = toNullableString(input.seoDescription)
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
      "News entry id is required"
    )
  }
  const newsService = req.scope.resolve("news") as NewsService
  const entry = await newsService.retrieveNewsEntry(id)

  if (!entry) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "News entry not found"
    )
  }

  res.status(200).json({ entry: serializeNewsEntry(entry) })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = entryUpdateSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid news payload"
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
      "News entry id is required"
    )
  }

  const newsService = req.scope.resolve("news") as NewsService
  const updatedResult = await newsService.updateNewsEntries([
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
      "News entry not found"
    )
  }

  res.status(200).json({ entry: serializeNewsEntry(updated) })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "News entry id is required"
    )
  }
  const newsService = req.scope.resolve("news") as NewsService
  await newsService.deleteNewsEntries(id)
  res.sendStatus(204)
}
