import { z } from "zod"

import { AdminRequestError } from "../../lib/admin-request"
import {
  assertCurrentGallery,
  fetchGalleryActor,
  galleryCanonical,
  galleryInputs,
  galleryPreflight,
  gallerySemantics,
  productGalleryBodySchema,
  productGallerySchema,
  putProductGallery,
  type GalleryLink,
  type GalleryRequestOptions,
  type ProductGallery,
} from "./product-gallery-query"

const productIdSchema = productGallerySchema.shape.productId
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
    productId: productIdSchema,
  })
  .strict()
export type GalleryContext = z.infer<typeof contextSchema>
export type GalleryBoundary = GalleryRequestOptions & {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  locks: Pick<LockManager, "request"> | undefined
}
const MAX_RECORD_BYTES = 256 * 1_024

export const galleryStorageKey = (productId: string): string =>
  `remorseless-records.product-gallery.v1.${productIdSchema.parse(productId)}`

export const galleryProjectionMatches = (
  record: {
    context: GalleryContext
    body: z.infer<typeof productGalleryBodySchema>
  },
  response: ProductGallery
): boolean =>
  response.productId === record.context.productId &&
  response.version === record.body.expectedVersion + 1 &&
  gallerySemantics(response.media) === gallerySemantics(record.body.media)

export const savedGallerySchema = z
  .object({
    version: z.literal(1),
    context: contextSchema,
    body: productGalleryBodySchema,
    status: z.enum(["uncertain", "confirmed"]),
    projection: productGallerySchema.nullable(),
  })
  .strict()
  .refine(
    (record) =>
      (record.status === "confirmed") === (record.projection !== null) &&
      (!record.projection ||
        galleryProjectionMatches(record, record.projection))
  )
export type SavedGallery = z.infer<typeof savedGallerySchema>
export type GalleryAttempt = { record: SavedGallery; error?: unknown }

const immutableIdentity = (record: SavedGallery): string =>
  galleryCanonical({ context: record.context, body: record.body })

export const readSavedGallery = (
  productId: string,
  storage: GalleryBoundary["storage"]
): SavedGallery | null => {
  const raw = storage.getItem(galleryStorageKey(productId))
  if (raw === null) return null
  if (new TextEncoder().encode(raw).length > MAX_RECORD_BYTES)
    throw new Error("The saved gallery request is too large to verify.")
  // An invalid record may represent a sent command. Keep it for recovery.
  const value: unknown = JSON.parse(raw)
  const record = savedGallerySchema.parse(value)
  if (record.context.productId !== productId)
    throw new Error("The saved gallery belongs to another product.")
  return record
}

export const saveGallery = (
  record: SavedGallery,
  storage: GalleryBoundary["storage"]
): void => {
  const parsed = savedGallerySchema.parse(record)
  const existing = readSavedGallery(parsed.context.productId, storage)
  if (existing && immutableIdentity(existing) !== immutableIdentity(parsed))
    throw new Error(
      "Another gallery request is saved. Recover it before editing again."
    )
  if (existing?.status === "confirmed" && parsed.status !== "confirmed")
    throw new Error("A confirmed request cannot become uncertain.")
  const serialized = JSON.stringify(parsed)
  if (new TextEncoder().encode(serialized).length > MAX_RECORD_BYTES)
    throw new Error("The gallery request is too large to save safely.")
  const key = galleryStorageKey(parsed.context.productId)
  storage.setItem(key, serialized)
  if (storage.getItem(key) !== serialized)
    throw new Error("The gallery request could not be saved. Nothing was sent.")
}

const withGalleryLock = async <T>(
  productId: string,
  boundary: GalleryBoundary,
  operation: () => Promise<T>
): Promise<T> => {
  if (!boundary.locks?.request)
    throw new Error("This browser cannot safely coordinate gallery requests.")
  return boundary.locks.request(
    galleryStorageKey(productId),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("Another tab is saving this gallery. Try again later.")
      return operation()
    }
  )
}

const assertOwner = (
  record: SavedGallery,
  context: GalleryContext,
  actorId: string
): void => {
  if (
    record.context.productId !== context.productId ||
    record.context.backendOrigin !== context.backendOrigin ||
    record.body.expectedActorId !== actorId
  )
    throw new Error(
      "The saved gallery request belongs to another server or administrator. Recover it in its original session."
    )
}

export const restoreGallery = async (
  context: GalleryContext,
  boundary: GalleryBoundary
): Promise<SavedGallery | null> => {
  const parsed = contextSchema.parse(context)
  return withGalleryLock(parsed.productId, boundary, async () => {
    const actorId = await fetchGalleryActor(boundary)
    const record = readSavedGallery(parsed.productId, boundary.storage)
    if (record) assertOwner(record, parsed, actorId)
    assertCurrentGallery(boundary)
    return record
  })
}

const attempt = async (
  record: SavedGallery,
  boundary: GalleryBoundary
): Promise<GalleryAttempt> => {
  try {
    const projection = await putProductGallery(
      record.context.productId,
      record.body,
      boundary
    )
    if (!galleryProjectionMatches(record, projection))
      throw new AdminRequestError(
        "The current gallery does not match the saved request. Keep this request for recovery.",
        "invalid-response"
      )
    // This is a matching current projection after a successful HTTP command,
    // not an immutable historical operation receipt or a GET-only inference.
    const confirmed: SavedGallery = {
      ...record,
      status: "confirmed",
      projection,
    }
    saveGallery(confirmed, boundary.storage)
    return { record: confirmed }
  } catch (error) {
    // A timeout, malformed reply or any HTTP rejection can follow a command
    // that already committed. Never rebase its version or replace its UUID.
    return { record, error }
  }
}

export const beginGallery = async (
  context: GalleryContext,
  loaded: ProductGallery,
  media: readonly GalleryLink[],
  profileId: string | null | undefined,
  variantIds: readonly string[],
  boundary: GalleryBoundary,
  uuid: () => string = () => crypto.randomUUID()
): Promise<GalleryAttempt> => {
  const parsed = contextSchema.parse(context)
  const snapshot = productGallerySchema.parse(loaded)
  const draft = z
    .array(productGallerySchema.shape.media.element)
    .max(100)
    .parse(media)
  if (
    snapshot.productId !== parsed.productId ||
    draft.some((item) => item.productId !== parsed.productId)
  )
    throw new Error("The loaded gallery belongs to another product.")
  const problem = galleryPreflight(draft, profileId, variantIds)
  if (problem) throw new Error(problem)
  // This editor changes existing links only; it cannot inject another asset
  // or alter file metadata while selecting a primary image or changing order.
  if (
    draft.length !== snapshot.media.length ||
    draft.some((item) => {
      const original = snapshot.media.find((row) => row.id === item.id)
      return (
        !original ||
        original.mediaAssetId !== item.mediaAssetId ||
        original.variantId !== item.variantId ||
        original.productProfileId !== item.productProfileId ||
        galleryCanonical(original.metadata) !==
          galleryCanonical(item.metadata) ||
        galleryCanonical(original.asset) !== galleryCanonical(item.asset)
      )
    })
  )
    throw new Error(
      "The gallery's image ownership changed. Refresh before saving."
    )
  return withGalleryLock(parsed.productId, boundary, async () => {
    const actorId = await fetchGalleryActor(boundary)
    const existing = readSavedGallery(parsed.productId, boundary.storage)
    if (existing) {
      assertOwner(existing, parsed, actorId)
      return { record: existing }
    }
    assertCurrentGallery(boundary)
    const record: SavedGallery = savedGallerySchema.parse({
      version: 1,
      context: parsed,
      body: {
        expectedActorId: actorId,
        expectedVersion: snapshot.version,
        idempotencyKey: uuid(),
        media: galleryInputs(draft),
      },
      status: "uncertain",
      projection: null,
    })
    saveGallery(record, boundary.storage)
    return attempt(record, boundary)
  })
}

export const retryGallery = async (
  expected: SavedGallery,
  context: GalleryContext,
  boundary: GalleryBoundary
): Promise<GalleryAttempt> => {
  const parsed = contextSchema.parse(context)
  return withGalleryLock(parsed.productId, boundary, async () => {
    const actorId = await fetchGalleryActor(boundary)
    const record = readSavedGallery(parsed.productId, boundary.storage)
    if (!record || immutableIdentity(record) !== immutableIdentity(expected))
      throw new Error(
        "The saved gallery request changed. Reload its saved state."
      )
    assertOwner(record, parsed, actorId)
    assertCurrentGallery(boundary)
    return attempt(record, boundary)
  })
}

export const clearConfirmedGallery = async (
  expected: SavedGallery,
  context: GalleryContext,
  boundary: GalleryBoundary
): Promise<void> => {
  const parsed = contextSchema.parse(context)
  return withGalleryLock(parsed.productId, boundary, async () => {
    const actorId = await fetchGalleryActor(boundary)
    const record = readSavedGallery(parsed.productId, boundary.storage)
    if (
      !record ||
      record.status !== "confirmed" ||
      immutableIdentity(record) !== immutableIdentity(expected)
    )
      throw new Error(
        "Only a confirmed gallery request can be cleared for another edit."
      )
    assertOwner(record, parsed, actorId)
    assertCurrentGallery(boundary)
    boundary.storage.removeItem(galleryStorageKey(parsed.productId))
    if (readSavedGallery(parsed.productId, boundary.storage))
      throw new Error("The confirmed gallery request could not be cleared.")
  })
}

export const scheduleGalleryRestore = async (
  isCurrent: () => boolean,
  restore: () => Promise<void>
): Promise<void> => {
  // React 18 StrictMode's obsolete initial read must not claim the WebLock
  // before its cleanup invalidates the captured mount epoch.
  await Promise.resolve()
  if (isCurrent()) await restore()
}
