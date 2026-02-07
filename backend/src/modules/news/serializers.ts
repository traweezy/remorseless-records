export const newsStatusValues = [
  "draft",
  "published",
  "scheduled",
  "archived",
] as const

export type NewsStatus = (typeof newsStatusValues)[number]

export type NewsEntryRecord = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  author: string | null
  status: NewsStatus
  published_at: Date | string | null
  tags: string[] | null
  cover_url: string | null
  seo_title: string | null
  seo_description: string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

export type NewsEntryDTO = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  author: string | null
  status: NewsStatus
  publishedAt: string | null
  tags: string[]
  coverUrl: string | null
  seoTitle: string | null
  seoDescription: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const serializeNewsEntry = (entry: NewsEntryRecord): NewsEntryDTO => ({
  id: entry.id,
  title: entry.title,
  slug: entry.slug,
  excerpt: entry.excerpt ?? null,
  content: entry.content,
  author: entry.author ?? null,
  status: entry.status,
  publishedAt: toIso(entry.published_at),
  tags: entry.tags ?? [],
  coverUrl: entry.cover_url ?? null,
  seoTitle: entry.seo_title ?? null,
  seoDescription: entry.seo_description ?? null,
  createdAt: toIso(entry.created_at),
  updatedAt: toIso(entry.updated_at),
})
