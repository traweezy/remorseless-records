import { unstable_cache } from "next/cache"

import { runtimeEnv } from "@/config/env"
import { createUpstreamHeaders } from "@/lib/http/correlation"
import {
  fetchProviderRead,
  ProviderRequestError,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"

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

type NewsApiEntry = {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  author: string | null
  status: NewsStatus
  publishedAt: string | null
  tags?: string[]
  coverUrl: string | null
  coverAltText?: string | null
  seoTitle: string | null
  seoDescription: string | null
  createdAt?: string | null
  updatedAt?: string | null
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

const normalizeText = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const normalizeEntry = (entry: NewsApiEntry): NewsEntry => ({
  id: entry.id,
  title: entry.title,
  slug: entry.slug,
  excerpt: normalizeText(entry.excerpt),
  content: entry.content,
  author: normalizeText(entry.author),
  status: entry.status,
  publishedAt: normalizeText(entry.publishedAt),
  tags: Array.isArray(entry.tags) ? entry.tags : [],
  coverUrl: normalizeText(entry.coverUrl),
  coverAltText: normalizeText(entry.coverAltText),
  seoTitle: normalizeText(entry.seoTitle),
  seoDescription: normalizeText(entry.seoDescription),
  createdAt: normalizeText(entry.createdAt),
  updatedAt: normalizeText(entry.updatedAt),
})

export const fetchNewsEntries = async ({
  limit,
  offset,
  request,
}: {
  limit: number
  offset: number
  request?: Request
}): Promise<NewsListResponse> => {
  if (!runtimeEnv.medusaBackendUrl || !runtimeEnv.medusaPublishableKey) {
    console.error("[news] Missing Medusa configuration")
    return { entries: [], count: 0, offset, limit }
  }

  try {
    const url = new URL("/store/news", runtimeEnv.medusaBackendUrl)
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("offset", String(offset))

    const response = await fetchProviderRead(url.toString(), {
      headers: request
        ? createUpstreamHeaders(request, {
            "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
          })
        : { "x-publishable-api-key": runtimeEnv.medusaPublishableKey },
      ...(request
        ? { cache: "no-store" as const }
        : { next: { revalidate: 300, tags: ["news"] } }),
      ...(request ? { signal: request.signal } : {}),
    })

    if (!response.ok) {
      if (request) {
        throw new ProviderRequestError("unavailable")
      }
      console.error("[news] Failed to fetch entries", {
        status: response.status,
      })
      return { entries: [], count: 0, offset, limit }
    }

    const payload = (await response.json()) as {
      entries?: NewsApiEntry[]
      count?: number
      offset?: number
      limit?: number
    }

    return {
      entries: (payload.entries ?? []).map(normalizeEntry),
      count: typeof payload.count === "number" ? payload.count : 0,
      offset: typeof payload.offset === "number" ? payload.offset : offset,
      limit: typeof payload.limit === "number" ? payload.limit : limit,
    }
  } catch (error) {
    const providerError = toProviderRequestError(error)
    if (request) {
      throw providerError
    }
    console.error("[news] Failed to fetch entries", {
      failure: providerError.kind,
    })
    return { entries: [], count: 0, offset, limit }
  }
}

export const fetchNewsEntryBySlug = async (
  slug: string
): Promise<NewsEntry | null> => {
  if (!runtimeEnv.medusaBackendUrl || !runtimeEnv.medusaPublishableKey) {
    console.error("[news] Missing Medusa configuration")
    return null
  }

  const normalizedSlug = slug.trim()
  if (!normalizedSlug) {
    return null
  }

  try {
    const url = new URL(
      `/store/news/${encodeURIComponent(normalizedSlug)}`,
      runtimeEnv.medusaBackendUrl
    )

    const response = await fetchProviderRead(url.toString(), {
      headers: {
        "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
      },
      next: { revalidate: 300, tags: ["news"] },
    })

    if (!response.ok) {
      if (response.status !== 404) {
        console.error("[news] Failed to fetch entry", {
          status: response.status,
        })
      }
      return null
    }

    const payload = (await response.json()) as { entry?: NewsApiEntry | null }
    return payload.entry ? normalizeEntry(payload.entry) : null
  } catch (error) {
    console.error("[news] Failed to fetch entry", {
      failure: toProviderRequestError(error).kind,
    })
    return null
  }
}

export const getNewsEntries = unstable_cache(
  async (): Promise<NewsListResponse> =>
    fetchNewsEntries({ limit: NEWS_PAGE_SIZE, offset: 0 }),
  ["news", "page-0"],
  { revalidate: 300, tags: ["news"] }
)

export const getNewsEntryBySlug = async (
  slug: string
): Promise<NewsEntry | null> => {
  const normalizedSlug = slug.trim()
  if (!normalizedSlug) {
    return null
  }
  const cached = unstable_cache(
    async () => fetchNewsEntryBySlug(normalizedSlug),
    ["news", `slug-${normalizedSlug}`],
    { revalidate: 300, tags: ["news"] }
  )
  return cached()
}
