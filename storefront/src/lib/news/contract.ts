import { z } from "zod"

export const NEWS_PAGE_SIZE = 6
export const NEWS_MAX_PAGE_SIZE = 24

const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable()
const nullableTimestamp = z.string().trim().datetime().nullable()

export const newsEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u),
    excerpt: nullableText(4_000),
    content: z.string().max(500_000),
    author: nullableText(300),
    status: z.literal("published"),
    publishedAt: nullableTimestamp,
    tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    coverUrl: nullableText(2_048),
    coverAltText: nullableText(1_000).optional(),
    seoTitle: nullableText(500),
    seoDescription: nullableText(2_000),
    version: z.number().int().min(1).max(1_000_000_000).optional(),
    archivedAt: nullableTimestamp.optional(),
    createdAt: nullableTimestamp.optional(),
    updatedAt: nullableTimestamp.optional(),
  })
  .strict()

const newsListPayloadSchema = z
  .object({
    entries: z.array(newsEntrySchema).max(NEWS_MAX_PAGE_SIZE),
    count: z.number().int().min(0).max(1_000_000).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(NEWS_MAX_PAGE_SIZE).optional(),
  })
  .strict()

const newsEntryPayloadSchema = z
  .object({
    entry: newsEntrySchema.nullable(),
  })
  .strict()

export type NewsStatus = "published"

export type NewsEntry = Omit<
  z.infer<typeof newsEntrySchema>,
  "archivedAt" | "coverAltText" | "createdAt" | "tags" | "updatedAt" | "version"
> & {
  coverAltText: string | null
  createdAt: string | null
  tags: string[]
  updatedAt: string | null
}

export type NewsListResponse = {
  entries: NewsEntry[]
  count: number
  offset: number
  limit: number
}

export type NewsEntryResponse = {
  entry: NewsEntry | null
}

const assertUniqueNewsEntries = (
  entries: ReadonlyArray<{ id: string; slug: string }>
): void => {
  const ids = new Set<string>()
  const slugs = new Set<string>()
  for (const entry of entries) {
    if (ids.has(entry.id) || slugs.has(entry.slug)) {
      throw new Error("News response contains duplicate entries")
    }
    ids.add(entry.id)
    slugs.add(entry.slug)
  }
}

const toNewsEntry = (entry: z.infer<typeof newsEntrySchema>): NewsEntry => ({
  id: entry.id,
  title: entry.title,
  slug: entry.slug,
  excerpt: entry.excerpt,
  content: entry.content,
  author: entry.author,
  status: entry.status,
  publishedAt: entry.publishedAt,
  tags: entry.tags ?? [],
  coverUrl: entry.coverUrl,
  coverAltText: entry.coverAltText ?? null,
  seoTitle: entry.seoTitle,
  seoDescription: entry.seoDescription,
  createdAt: entry.createdAt ?? null,
  updatedAt: entry.updatedAt ?? null,
})

export const parseNewsListResponse = (
  value: unknown,
  expected: { limit: number; offset: number }
): NewsListResponse => {
  const payload = newsListPayloadSchema.parse(value)
  const count = payload.count ?? 0
  const offset = payload.offset ?? expected.offset
  const limit = payload.limit ?? expected.limit

  if (
    offset !== expected.offset ||
    limit !== expected.limit ||
    payload.entries.length > limit ||
    count < offset + payload.entries.length
  ) {
    throw new Error("News response pagination is inconsistent")
  }
  assertUniqueNewsEntries(payload.entries)

  return {
    entries: payload.entries.map(toNewsEntry),
    count,
    offset,
    limit,
  }
}

export const parseNewsEntryResponse = (value: unknown): NewsEntryResponse => {
  const payload = newsEntryPayloadSchema.parse(value)
  return {
    entry: payload.entry ? toNewsEntry(payload.entry) : null,
  }
}
