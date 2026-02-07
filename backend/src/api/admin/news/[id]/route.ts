import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { newsStatusValues, serializeNewsEntry } from "@/modules/news/serializers"
import {
  buildSeo,
  normalizeList,
  resolveAdminUserName,
  resolvePublishedAt,
  toNullableString,
  type NewsService,
} from "@/api/admin/news/utils"

const entryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  excerpt: z.string().trim().optional().nullable(),
  content: z.string().trim().min(1).optional(),
  status: z.enum(newsStatusValues).optional(),
  publishedAt: z.string().trim().optional().nullable(),
  tags: z.array(z.string().trim()).optional(),
  coverUrl: z.string().trim().url().optional().nullable(),
})

const buildUpdatePayload = async ({
  input,
  existing,
  req,
}: {
  input: z.infer<typeof entryUpdateSchema>
  existing: {
    title: string
    excerpt?: string | null
    content: string
    status?: string | null
    published_at?: Date | string | null
    tags?: string[] | null
    cover_url?: string | null
    author?: string | null
  }
  req: MedusaRequest
}): Promise<Record<string, unknown>> => {
  const title = input.title ?? existing.title
  const excerpt =
    input.excerpt !== undefined
      ? toNullableString(input.excerpt)
      : existing.excerpt ?? null
  const content = input.content ?? existing.content
  const status = input.status ?? existing.status ?? "draft"
  const publishedAt = resolvePublishedAt({
    status,
    publishedAt: input.publishedAt,
    existing: existing.published_at ?? null,
  })
  const tags =
    input.tags !== undefined ? normalizeList(input.tags) : existing.tags ?? []
  const coverUrl =
    input.coverUrl !== undefined
      ? toNullableString(input.coverUrl)
      : existing.cover_url ?? null
  const seo = buildSeo({ title, excerpt, content })
  const author = (await resolveAdminUserName(req)) ?? existing.author ?? null

  return {
    title,
    excerpt,
    content,
    status,
    published_at: publishedAt,
    tags,
    cover_url: coverUrl,
    author,
    seo_title: seo.seo_title,
    seo_description: seo.seo_description,
  }
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

  if (!Object.keys(parsed.data).length) {
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
  const existing = await newsService.retrieveNewsEntry(id)

  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "News entry not found"
    )
  }

  const payload = await buildUpdatePayload({
    input: parsed.data,
    existing,
    req,
  })
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
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "News entry not found")
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
