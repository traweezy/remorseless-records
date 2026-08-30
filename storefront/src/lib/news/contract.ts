export const NEWS_PAGE_SIZE = 6

export type NewsStatus = "published"

export type NewsEntry = {
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
  coverAltText: string | null
  seoTitle: string | null
  seoDescription: string | null
  createdAt: string | null
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
