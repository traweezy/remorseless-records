import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type NewsModuleService from "@/modules/news/service"
import {
  newsStatusValues,
  serializeNewsEntry,
} from "@/modules/news/serializers"

type NewsService = InstanceType<typeof NewsModuleService>

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(["published_at", "created_at", "title", "status"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  status: z.enum(newsStatusValues).optional(),
})

const entryBaseSchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  excerpt: z.string().trim().optional().nullable(),
  content: z.string().trim().min(1),
  author: z.string().trim().optional().nullable(),
  status: z.enum(newsStatusValues).optional(),
  publishedAt: z.string().trim().optional().nullable(),
  tags: z.array(z.string().trim()).optional(),
  coverUrl: z.string().trim().url().optional().nullable(),
  seoTitle: z.string().trim().optional().nullable(),
  seoDescription: z.string().trim().optional().nullable(),
})

const slugify = (value: string): string => {
  const trimmed = value.trim().toLowerCase()
  const sanitized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return sanitized.length ? sanitized : "news"
}

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

const toEntryPayload = (input: z.infer<typeof entryBaseSchema>) => {
  const resolvedStatus = input.status ?? "draft"
  const parsedPublishedAt = toOptionalDate(input.publishedAt)
  const resolvedPublishedAt =
    resolvedStatus === "published" && !parsedPublishedAt
      ? new Date()
      : parsedPublishedAt

  return {
    title: input.title.trim(),
    slug: toNullableString(input.slug) ?? slugify(input.title),
    excerpt: toNullableString(input.excerpt),
    content: input.content.trim(),
    author: toNullableString(input.author),
    status: resolvedStatus,
    published_at: resolvedPublishedAt,
    tags: normalizeList(input.tags),
    cover_url: toNullableString(input.coverUrl),
    seo_title: toNullableString(input.seoTitle),
    seo_description: toNullableString(input.seoDescription),
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
    toEntryPayload(parsed.data),
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
