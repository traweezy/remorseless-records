import { z } from "zod"

const DEFAULT_MAX_DRAFT_BYTES = 512 * 1_024
const DEFAULT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000

const adminFormDraftEnvelopeSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }),
  savedAt: z.string().datetime({ offset: true }),
  values: z.unknown(),
  version: z.literal(1),
})

export type AdminFormDraft<T> = {
  savedAt: string
  values: T
}

export type AdminFormDraftStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>

export type AdminFormDraftOptions<T> = {
  key: string
  maxBytes?: number
  now?: Date
  schema: z.ZodType<T>
  storage: AdminFormDraftStorage
  ttlMs?: number
}

const validatedPositiveInteger = (
  value: number | undefined,
  fallback: number,
  name: string
): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer.`)
  }
  return resolved
}

const validatedNow = (now: Date | undefined): Date => {
  const resolved = now ?? new Date()
  if (!Number.isFinite(resolved.getTime())) {
    throw new TypeError("Draft time must be valid.")
  }
  return resolved
}

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length

export const clearAdminFormDraft = ({
  key,
  storage,
}: Pick<AdminFormDraftOptions<unknown>, "key" | "storage">): void => {
  storage.removeItem(key)
}

export const readAdminFormDraft = <T>({
  key,
  maxBytes,
  now,
  schema,
  storage,
}: AdminFormDraftOptions<T>): AdminFormDraft<T> | null => {
  const maximum = validatedPositiveInteger(
    maxBytes,
    DEFAULT_MAX_DRAFT_BYTES,
    "Draft byte limit"
  )
  const stored = storage.getItem(key)
  if (!stored) {
    return null
  }
  if (byteLength(stored) > maximum) {
    storage.removeItem(key)
    return null
  }
  try {
    const payload: unknown = JSON.parse(stored)
    const envelope = adminFormDraftEnvelopeSchema.parse(payload)
    if (Date.parse(envelope.expiresAt) <= validatedNow(now).getTime()) {
      storage.removeItem(key)
      return null
    }
    const values = schema.parse(envelope.values)
    return { savedAt: envelope.savedAt, values }
  } catch {
    storage.removeItem(key)
    return null
  }
}

export const writeAdminFormDraft = <T>({
  key,
  maxBytes,
  now,
  schema,
  storage,
  ttlMs,
  values,
}: AdminFormDraftOptions<T> & { values: T }): AdminFormDraft<T> => {
  const timestamp = validatedNow(now)
  const lifetime = validatedPositiveInteger(
    ttlMs,
    DEFAULT_DRAFT_TTL_MS,
    "Draft lifetime"
  )
  const maximum = validatedPositiveInteger(
    maxBytes,
    DEFAULT_MAX_DRAFT_BYTES,
    "Draft byte limit"
  )
  const parsedValues = schema.parse(values)
  const savedAt = timestamp.toISOString()
  const serialized = JSON.stringify({
    expiresAt: new Date(timestamp.getTime() + lifetime).toISOString(),
    savedAt,
    values: parsedValues,
    version: 1,
  })
  if (byteLength(serialized) > maximum) {
    throw new RangeError(`Draft exceeds the ${maximum}-byte browser limit.`)
  }
  storage.setItem(key, serialized)
  return { savedAt, values: parsedValues }
}
