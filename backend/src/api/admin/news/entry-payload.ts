import { MedusaError } from "@medusajs/framework/utils"

import {
  hasVisibleRichText,
  sanitizeRichTextHtml,
} from "@/lib/content/rich-text"
import {
  type NewsEntryRecord,
  type NewsWriteStatus,
} from "@/modules/news/serializers"
import type { NewsCreateInput, NewsUpdateInput } from "./contracts"
import type { NewsService, NewsTransactionContext } from "./command"
import {
  buildSeo,
  normalizeList,
  slugify,
  toNullableString,
} from "./utils"

const parseStoredDate = (
  value: Date | string | null | undefined
): Date | null => {
  if (!value) {
    return null
  }
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parseInputDate = (value: string | null | undefined): Date | null => {
  if (!value?.trim()) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Publication date is invalid."
    )
  }
  return parsed
}

const resolvePublication = ({
  existing,
  input,
  now,
}: {
  existing: NewsEntryRecord | undefined
  input: NewsCreateInput | NewsUpdateInput
  now: Date
}): { publishedAt: Date | null; status: NewsWriteStatus } => {
  const existingStatus: NewsWriteStatus =
    existing?.status === "scheduled" || existing?.status === "published"
      ? existing.status
      : "draft"
  const status = input.status ?? existingStatus
  const existingPublishedAt = parseStoredDate(existing?.published_at)
  const suppliedPublishedAt =
    input.publishedAt === undefined
      ? undefined
      : parseInputDate(input.publishedAt)

  if (status === "draft") {
    if (suppliedPublishedAt) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Draft posts cannot have a publication date. Choose Scheduled instead."
      )
    }
    return { publishedAt: null, status }
  }

  if (status === "scheduled") {
    const publishedAt = suppliedPublishedAt ?? existingPublishedAt
    if (!publishedAt || publishedAt.getTime() <= now.getTime()) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Scheduled posts require a future publication date."
      )
    }
    return { publishedAt, status }
  }

  const shouldPublishNow =
    input.status === "published" && existingStatus !== "published"
  const publishedAt =
    suppliedPublishedAt ??
    (shouldPublishNow ? now : existingPublishedAt) ??
    now
  if (publishedAt.getTime() > now.getTime()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Future publication dates must use Scheduled status."
    )
  }
  return { publishedAt, status }
}

export const buildNewsEntryPatch = ({
  existing,
  input,
  now,
}: {
  existing?: NewsEntryRecord
  input: NewsCreateInput | NewsUpdateInput
  now: Date
}): Record<string, unknown> => {
  const title = input.title?.trim() ?? existing?.title
  const rawContent = input.content ?? existing?.content
  if (!title || !rawContent) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "News title and content are required."
    )
  }
  const content = sanitizeRichTextHtml(rawContent)
  if (!hasVisibleRichText(content)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "News content must include visible text."
    )
  }
  const excerpt =
    input.excerpt !== undefined
      ? toNullableString(input.excerpt)
      : existing?.excerpt ?? null
  const coverUrl =
    input.coverUrl !== undefined
      ? toNullableString(input.coverUrl)
      : existing?.cover_url ?? null
  const coverAltText =
    input.coverAltText !== undefined
      ? toNullableString(input.coverAltText)
      : existing?.cover_alt_text ?? null
  if (coverUrl && !coverAltText) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cover alt text is required when a cover image is present."
    )
  }
  const publication = resolvePublication({ existing, input, now })
  const seo = buildSeo({ title, excerpt, content })
  return {
    content,
    cover_alt_text: coverUrl ? coverAltText : null,
    cover_url: coverUrl,
    excerpt,
    published_at: publication.publishedAt,
    seo_description: seo.seo_description,
    seo_title: seo.seo_title,
    status: publication.status,
    tags:
      input.tags !== undefined
        ? normalizeList(input.tags)
        : existing?.tags ?? [],
    title,
  }
}

export const resolveUniqueNewsSlug = async (
  service: NewsService,
  title: string,
  idempotencyKey: string,
  sharedContext: NewsTransactionContext
): Promise<string> => {
  const normalizedBase =
    slugify(title).slice(0, 180).replace(/-+$/, "") || "news"
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? normalizedBase : `${normalizedBase}-${suffix + 1}`
    const existing = await service.listNewsEntries(
      { slug: candidate },
      { take: 1 },
      sharedContext
    )
    if (!existing.length) {
      return candidate
    }
  }
  return `${normalizedBase}-${idempotencyKey}`
}
