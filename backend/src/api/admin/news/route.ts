import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  newsStatusValues,
  serializeNewsEntry,
} from "@/modules/news/serializers"
import {
  buildSeo,
  normalizeList,
  resolveAdminUserName,
  resolvePublishedAt,
  resolveUniqueSlug,
  slugify,
  toNullableString,
  type NewsService,
} from "./utils"

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(["published_at", "created_at", "title", "status"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  status: z.enum(newsStatusValues).optional(),
})

const entryBaseSchema = z.object({
  title: z.string().trim().min(1),
  excerpt: z.string().trim().optional().nullable(),
  content: z.string().trim().min(1),
  status: z.enum(newsStatusValues).optional(),
  publishedAt: z.string().trim().optional().nullable(),
  tags: z.array(z.string().trim()).optional(),
  coverUrl: z.string().trim().url().optional().nullable(),
})

const toEntryPayload = async (
  input: z.infer<typeof entryBaseSchema>,
  newsService: NewsService,
  req: MedusaRequest
) => {
  const resolvedStatus = input.status ?? "draft"
  const baseSlug = slugify(input.title)
  const slug = await resolveUniqueSlug(newsService, baseSlug)
  const author = await resolveAdminUserName(req)
  const excerpt = toNullableString(input.excerpt)
  const content = input.content.trim()
  const seo = buildSeo({ title: input.title, excerpt, content })

  return {
    title: input.title.trim(),
    slug,
    excerpt,
    content,
    author,
    status: resolvedStatus,
    published_at: resolvePublishedAt({
      status: resolvedStatus,
      publishedAt: input.publishedAt,
    }),
    tags: normalizeList(input.tags),
    cover_url: toNullableString(input.coverUrl),
    seo_title: seo.seo_title,
    seo_description: seo.seo_description,
  }
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { limit, offset, order, direction, status } = listQuerySchema.parse(
    req.query
  )
  const newsService = req.scope.resolve("news") as NewsService

  const take = limit ?? 100
  const skip = offset ?? 0
  const sortField = order ?? "published_at"
  const sortDirection = (direction ?? "desc").toUpperCase() as "ASC" | "DESC"
  const filter: Record<string, unknown> = {}

  if (status) {
    filter.status = status
  }

  const [entries, count] = await newsService.listAndCountNewsEntries(filter, {
    skip,
    take,
    order: { [sortField]: sortDirection },
  })

  res.status(200).json({
    entries: entries.map(serializeNewsEntry),
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
      "Invalid news payload"
    )
  }

  const newsService = req.scope.resolve("news") as NewsService
  const createdResult = await newsService.createNewsEntries([
    await toEntryPayload(parsed.data, newsService, req),
  ])
  const created = Array.isArray(createdResult)
    ? createdResult[0]
    : createdResult

  if (!created) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create news entry"
    )
  }

  res.status(201).json({ entry: serializeNewsEntry(created) })
}
