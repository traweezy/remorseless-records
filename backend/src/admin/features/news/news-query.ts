import { z } from "zod"

import {
  AdminRequestError,
  requestAdminJson,
  type AdminSdkClient,
} from "../../lib/admin-request"

export const newsStatusValues = [
  "draft",
  "scheduled",
  "published",
  "archived",
] as const
export const newsWriteStatusValues = [
  "draft",
  "scheduled",
  "published",
] as const

export const newsEntrySchema = z.object({
  archivedAt: z.string().nullable(),
  author: z.string().nullable(),
  content: z.string(),
  coverAltText: z.string().nullable(),
  coverUrl: z.string().nullable(),
  createdAt: z.string().nullable().optional(),
  excerpt: z.string().nullable(),
  id: z.string(),
  publishedAt: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoTitle: z.string().nullable(),
  slug: z.string(),
  status: z.enum(newsStatusValues),
  tags: z.array(z.string()),
  title: z.string(),
  updatedAt: z.string().nullable().optional(),
  version: z.number().int().min(1),
})

export const newsPageSchema = z.object({
  count: z.number().int().min(0),
  entries: z.array(newsEntrySchema),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
})

export const newsMutationSchema = z.object({
  entry: newsEntrySchema,
  replayed: z.boolean(),
})

const newsEntryResponseSchema = z.object({ entry: newsEntrySchema })

export type NewsStatus = (typeof newsStatusValues)[number]
export type NewsWriteStatus = (typeof newsWriteStatusValues)[number]
export type NewsEntry = z.infer<typeof newsEntrySchema>
export type NewsMutation = z.infer<typeof newsMutationSchema>
export type NewsPage = z.infer<typeof newsPageSchema>

export type NewsListInput = {
  archived: "active" | "archived"
  direction: "asc" | "desc"
  limit: number
  offset: number
  order: "created_at" | "published_at" | "status" | "title" | "updated_at"
  q: string
  status: NewsWriteStatus | "all"
}

export type NewsWriteInput = {
  content: string
  coverAltText: string | null
  coverUrl: string | null
  excerpt: string | null
  publishedAt: string | null
  status: NewsWriteStatus
  tags: string[]
  title: string
}

export const newsActorSchema = z
  .string()
  .max(255)
  .regex(/^user_[A-Za-z0-9]+$/u)
export const newsUpdateBodySchema = z
  .object({
    content: z.string().trim().min(1).max(200_000),
    coverAltText: z.string().max(500).nullable(),
    coverUrl: z.string().url().max(2_000).nullable(),
    excerpt: z.string().max(1_000).nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(newsWriteStatusValues),
    tags: z.array(z.string().min(1).max(100)).max(50),
    title: z.string().trim().min(1).max(300),
    expectedActorId: newsActorSchema,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.uuid(),
  })
  .strict()
export type NewsUpdateBody = z.infer<typeof newsUpdateBodySchema>
export type NewsCommandOptions = {
  client?: AdminSdkClient
  isCurrent?: () => boolean
}
export const assertNewsCommandCurrent = (options: NewsCommandOptions): void => {
  if (options.isCurrent?.() === false)
    throw new AdminRequestError(
      "The News editor changed. Keep its saved request.",
      "cancelled"
    )
}
export const fetchNewsActor = async (
  options: NewsCommandOptions = {}
): Promise<string> => {
  assertNewsCommandCurrent(options)
  const reply = await requestAdminJson({
    path: "/admin/users/me",
    schema: z.object({ user: z.object({ id: newsActorSchema }) }),
    ...(options.client ? { client: options.client } : {}),
  })
  assertNewsCommandCurrent(options)
  return reply.user.id
}
export const putNewsCommand = async (
  id: string,
  body: NewsUpdateBody,
  options: NewsCommandOptions = {}
): Promise<NewsMutation> => {
  const request = newsUpdateBodySchema.parse(body)
  assertNewsCommandCurrent(options)
  const reply = await requestAdminJson({
    path: `/admin/news/${encodeURIComponent(id)}`,
    method: "PUT",
    body: request,
    schema: newsMutationSchema,
    ...(options.client ? { client: options.client } : {}),
  })
  assertNewsCommandCurrent(options)
  return reply
}

export const listNewsEntries = (
  input: NewsListInput,
  signal?: AbortSignal
): Promise<NewsPage> =>
  requestAdminJson({
    path: "/admin/news",
    query: {
      archived: input.archived,
      direction: input.direction,
      limit: input.limit,
      offset: input.offset,
      order: input.order,
      ...(input.q.trim() ? { q: input.q.trim() } : {}),
      ...(input.status === "all" ? {} : { status: input.status }),
    },
    schema: newsPageSchema,
    ...(signal ? { signal } : {}),
  })

export const getNewsEntry = (
  id: string,
  signal?: AbortSignal
): Promise<NewsEntry> =>
  requestAdminJson({
    path: `/admin/news/${encodeURIComponent(id)}`,
    schema: newsEntryResponseSchema,
    ...(signal ? { signal } : {}),
  }).then(({ entry }) => entry)

export const createNewsEntry = (
  input: NewsWriteInput,
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      ...input,
      expectedVersion: 0,
      idempotencyKey,
    },
    method: "POST",
    path: "/admin/news",
    schema: newsMutationSchema,
  })

export const updateNewsEntry = (
  entry: NewsEntry,
  input: NewsWriteInput,
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      ...input,
      expectedVersion: entry.version,
      idempotencyKey,
    },
    method: "PUT",
    path: `/admin/news/${encodeURIComponent(entry.id)}`,
    schema: newsMutationSchema,
  })

export const updateNewsLifecycle = (
  entry: NewsEntry,
  action: "archive" | "restore",
  idempotencyKey: string
) =>
  requestAdminJson({
    body: {
      expectedVersion: entry.version,
      idempotencyKey,
    },
    method: "POST",
    path: `/admin/news/${encodeURIComponent(entry.id)}/${action}`,
    schema: newsMutationSchema,
  })
