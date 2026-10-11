import { z } from "zod"

import {
  sanitizeRichTextHtml,
  richTextToPlainText,
} from "../../../lib/content/rich-text"

import { AdminRequestError } from "../../lib/admin-request"
import {
  assertNewsCommandCurrent,
  fetchNewsActor,
  newsEntrySchema,
  newsMutationSchema,
  newsUpdateBodySchema,
  putNewsCommand,
  type NewsCommandOptions,
  type NewsEntry,
  type NewsMutation,
  type NewsWriteInput,
} from "./news-query"
import type { NewsPublicationIntent } from "./news-form-state"
import { clearConfirmedNewsDraft } from "./news-command-draft"

export const newsCommandStorageKey = "remorseless-records.news-update.v1"
// Original entry, submitted body and historical acknowledgement can each carry
// the API's 200,000-character HTML limit. Bound their escaped UTF-8 envelope.
export const MAX_NEWS_COMMAND_BYTES = 4 * 1_024 * 1_024
const originSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && url.origin === value
  })
const contextSchema = z
  .object({
    backendOrigin: originSchema,
    entryId: z.string().regex(/^news_[A-Za-z0-9_-]{1,248}$/u),
  })
  .strict()
export type NewsCommandContext = z.infer<typeof contextSchema>
export type NewsCommandBoundary = NewsCommandOptions & {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  locks: Pick<LockManager, "request"> | undefined
}
const nullableText = (value: string | null): string | null =>
  value?.trim() || null
const normalizedTags = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const text = value.trim()
    const key = text.toLocaleLowerCase("en-US")
    if (!text || seen.has(key)) return []
    seen.add(key)
    return [text]
  })
}
const acknowledgementMatches = (
  record: {
    context: NewsCommandContext
    loadedEntry: NewsEntry
    body: z.infer<typeof newsUpdateBodySchema>
  },
  reply: NewsMutation
): boolean =>
  reply.entry.id === record.context.entryId &&
  reply.entry.version === record.body.expectedVersion + 1 &&
  reply.entry.archivedAt === null &&
  reply.entry.author === record.loadedEntry.author &&
  reply.entry.slug === record.loadedEntry.slug &&
  reply.entry.createdAt === record.loadedEntry.createdAt &&
  reply.entry.title === record.body.title.trim() &&
  reply.entry.content === sanitizeRichTextHtml(record.body.content) &&
  reply.entry.excerpt === nullableText(record.body.excerpt) &&
  reply.entry.seoTitle ===
    `${record.body.title.trim()} · Remorseless Records` &&
  reply.entry.seoDescription ===
    (nullableText(record.body.excerpt) ||
      richTextToPlainText(record.body.content).slice(0, 160).trim() ||
      null) &&
  reply.entry.coverUrl === nullableText(record.body.coverUrl) &&
  reply.entry.coverAltText ===
    (nullableText(record.body.coverUrl)
      ? nullableText(record.body.coverAltText)
      : null) &&
  JSON.stringify(reply.entry.tags) ===
    JSON.stringify(normalizedTags(record.body.tags)) &&
  reply.entry.status === record.body.status &&
  (record.body.status === "draft"
    ? reply.entry.publishedAt === null
    : record.body.status === "scheduled"
      ? reply.entry.publishedAt ===
        (record.body.publishedAt
          ? new Date(record.body.publishedAt).toISOString()
          : null)
      : record.body.publishedAt
        ? reply.entry.publishedAt ===
          new Date(record.body.publishedAt).toISOString()
        : record.loadedEntry.status === "published" &&
            record.loadedEntry.publishedAt
          ? reply.entry.publishedAt === record.loadedEntry.publishedAt
          : reply.entry.publishedAt !== null &&
            Number.isFinite(Date.parse(reply.entry.publishedAt)))

export const savedNewsCommandSchema = z
  .object({
    version: z.literal(1),
    context: contextSchema,
    loadedEntry: newsEntrySchema,
    intent: z.enum(["draft", "schedule", "publish"]),
    body: newsUpdateBodySchema,
    status: z.enum(["uncertain", "confirmed", "rejected"]),
    acknowledgement: newsMutationSchema.nullable(),
  })
  .strict()
  .refine(
    (record) =>
      record.loadedEntry.id === record.context.entryId &&
      record.loadedEntry.version === record.body.expectedVersion &&
      record.body.status ===
        (
          {
            draft: "draft",
            schedule: "scheduled",
            publish: "published",
          } as const
        )[record.intent] &&
      (record.status === "confirmed") === (record.acknowledgement !== null) &&
      (!record.acknowledgement ||
        acknowledgementMatches(record, record.acknowledgement))
  )
export type SavedNewsCommand = z.infer<typeof savedNewsCommandSchema>
export type NewsCommandAttempt = { record: SavedNewsCommand; error?: unknown }
const identity = (record: SavedNewsCommand): string =>
  JSON.stringify({
    context: record.context,
    loadedEntry: record.loadedEntry,
    body: record.body,
    intent: record.intent,
  })

export const readSavedNewsCommand = (
  storage: NewsCommandBoundary["storage"]
): SavedNewsCommand | null => {
  const raw = storage.getItem(newsCommandStorageKey)
  if (raw === null) return null
  if (new TextEncoder().encode(raw).length > MAX_NEWS_COMMAND_BYTES)
    throw new Error(
      "The saved News request is too large to verify. Keep it for recovery."
    )
  const value: unknown = JSON.parse(raw)
  return savedNewsCommandSchema.parse(value)
}
export const saveNewsCommand = (
  record: SavedNewsCommand,
  storage: NewsCommandBoundary["storage"]
): void => {
  const parsed = savedNewsCommandSchema.parse(record)
  const existing = readSavedNewsCommand(storage)
  if (existing && identity(existing) !== identity(parsed))
    throw new Error(
      "Another News request is saved. Recover it before editing again."
    )
  if (
    existing &&
    existing.status !== "uncertain" &&
    parsed.status !== existing.status
  )
    throw new Error(
      "A resolved News request cannot become uncertain or change its result."
    )
  if (
    existing?.acknowledgement &&
    JSON.stringify(existing.acknowledgement) !==
      JSON.stringify(parsed.acknowledgement)
  )
    throw new Error("The confirmed News acknowledgement cannot change.")
  const raw = JSON.stringify(parsed)
  if (new TextEncoder().encode(raw).length > MAX_NEWS_COMMAND_BYTES)
    throw new Error("The News request is too large to save. Nothing was sent.")
  storage.setItem(newsCommandStorageKey, raw)
  if (storage.getItem(newsCommandStorageKey) !== raw)
    throw new Error("The News request could not be saved. Nothing was sent.")
}
const withNewsLock = async <T>(
  boundary: NewsCommandBoundary,
  operation: () => Promise<T>
): Promise<T> => {
  if (!boundary.locks?.request)
    throw new Error("This browser cannot safely coordinate News requests.")
  return boundary.locks.request(
    newsCommandStorageKey,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("Another tab is saving News. Try again later.")
      assertNewsCommandCurrent(boundary)
      return operation()
    }
  )
}
const assertOwner = (
  record: SavedNewsCommand,
  backendOrigin: string,
  actorId: string
): void => {
  if (
    record.context.backendOrigin !== backendOrigin ||
    record.body.expectedActorId !== actorId
  )
    throw new Error(
      "The saved News request belongs to another server or administrator. Use its original administrator to recover it."
    )
}
export const restoreNewsCommand = async (
  backendOrigin: string,
  boundary: NewsCommandBoundary
): Promise<SavedNewsCommand | null> => {
  const origin = originSchema.parse(backendOrigin)
  return withNewsLock(boundary, async () => {
    const actorId = await fetchNewsActor(boundary)
    const record = readSavedNewsCommand(boundary.storage)
    if (record) assertOwner(record, origin, actorId)
    assertNewsCommandCurrent(boundary)
    return record
  })
}
const canRepeat = (error: unknown): boolean =>
  error instanceof AdminRequestError &&
  (["timeout", "invalid-response", "unknown"].includes(error.kind) ||
    (error.kind === "http" &&
      error.status !== undefined &&
      error.status >= 500 &&
      error.status <= 599))
const definitiveRejection = (error: unknown): boolean =>
  error instanceof AdminRequestError &&
  error.kind === "http" &&
  error.status !== undefined &&
  error.status >= 400 &&
  error.status <= 499
const send = async (
  record: SavedNewsCommand,
  boundary: NewsCommandBoundary
): Promise<SavedNewsCommand> => {
  const acknowledgement = await putNewsCommand(
    record.context.entryId,
    record.body,
    boundary
  )
  if (!acknowledgementMatches(record, acknowledgement))
    throw new AdminRequestError(
      "The News acknowledgement does not match this saved command. Keep it for recovery.",
      "invalid-response"
    )
  // This PUT acknowledgement is the server's immutable command result. It is
  // intentionally not inserted into the collection cache as current state.
  return { ...record, status: "confirmed", acknowledgement }
}
const attempt = async (
  record: SavedNewsCommand,
  boundary: NewsCommandBoundary,
  previouslyUncertain: boolean
): Promise<NewsCommandAttempt> => {
  if (record.status !== "uncertain") return { record }
  try {
    const confirmed = await send(record, boundary)
    saveNewsCommand(confirmed, boundary.storage)
    return { record: confirmed }
  } catch (firstError) {
    if (!previouslyUncertain && definitiveRejection(firstError)) {
      const rejected: SavedNewsCommand = { ...record, status: "rejected" }
      try {
        saveNewsCommand(rejected, boundary.storage)
      } catch (error) {
        return { record, error }
      }
      return { record: rejected, error: firstError }
    }
    if (!previouslyUncertain && canRepeat(firstError)) {
      try {
        const actorId = await fetchNewsActor(boundary)
        assertOwner(record, record.context.backendOrigin, actorId)
        const confirmed = await send(record, boundary)
        saveNewsCommand(confirmed, boundary.storage)
        return { record: confirmed }
      } catch (error) {
        return { record, error }
      }
    }
    return { record, error: firstError }
  }
}
export const beginNewsCommand = async (
  context: NewsCommandContext,
  loaded: NewsEntry,
  input: NewsWriteInput,
  intent: NewsPublicationIntent,
  idempotencyKey: string,
  boundary: NewsCommandBoundary
): Promise<NewsCommandAttempt> => {
  const parsed = contextSchema.parse(context)
  const snapshot = newsEntrySchema.parse(loaded)
  if (snapshot.id !== parsed.entryId)
    throw new Error("The News editor belongs to another post.")
  return withNewsLock(boundary, async () => {
    const actorId = await fetchNewsActor(boundary)
    const existing = readSavedNewsCommand(boundary.storage)
    if (existing) {
      assertOwner(existing, parsed.backendOrigin, actorId)
      throw new Error(
        "A News request is already saved. Recover that exact request before editing again."
      )
    }
    assertNewsCommandCurrent(boundary)
    const record = savedNewsCommandSchema.parse({
      version: 1,
      context: parsed,
      loadedEntry: snapshot,
      intent,
      body: {
        ...input,
        expectedActorId: actorId,
        expectedVersion: snapshot.version,
        idempotencyKey,
      },
      status: "uncertain",
      acknowledgement: null,
    })
    saveNewsCommand(record, boundary.storage)
    return attempt(record, boundary, false)
  })
}
export const retryNewsCommand = async (
  expected: SavedNewsCommand,
  backendOrigin: string,
  boundary: NewsCommandBoundary
): Promise<NewsCommandAttempt> =>
  withNewsLock(boundary, async () => {
    const actorId = await fetchNewsActor(boundary)
    const record = readSavedNewsCommand(boundary.storage)
    if (!record || identity(record) !== identity(expected))
      throw new Error(
        "The saved News request changed. Reload its recovery state."
      )
    assertOwner(record, originSchema.parse(backendOrigin), actorId)
    assertNewsCommandCurrent(boundary)
    return attempt(record, boundary, true)
  })
export const clearResolvedNewsCommand = async (
  expected: SavedNewsCommand,
  backendOrigin: string,
  boundary: NewsCommandBoundary
): Promise<void> =>
  withNewsLock(boundary, async () => {
    const actorId = await fetchNewsActor(boundary)
    const record = readSavedNewsCommand(boundary.storage)
    if (
      !record ||
      record.status === "uncertain" ||
      record.status !== expected.status ||
      identity(record) !== identity(expected)
    )
      throw new Error(
        "Only the exact confirmed or initially rejected News request can be cleared."
      )
    assertOwner(record, originSchema.parse(backendOrigin), actorId)
    assertNewsCommandCurrent(boundary)
    clearConfirmedNewsDraft(record, boundary.storage)
    boundary.storage.removeItem(newsCommandStorageKey)
    if (readSavedNewsCommand(boundary.storage))
      throw new Error("The resolved News request could not be cleared.")
  })
export const scheduleNewsRestore = async (
  isCurrent: () => boolean,
  restore: () => Promise<void>
): Promise<void> => {
  await Promise.resolve()
  if (isCurrent()) await restore()
}

export const finishNewsCommand = async (
  record: SavedNewsCommand,
  backendOrigin: string,
  boundary: NewsCommandBoundary,
  refresh: () => Promise<void>
): Promise<void> => {
  // A failed list refresh cannot turn a confirmed historical command into an
  // unsaved edit or erase the only durable recovery acknowledgement.
  await refresh()
  assertNewsCommandCurrent(boundary)
  await clearResolvedNewsCommand(record, backendOrigin, boundary)
}
