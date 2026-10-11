import { z } from "zod"

import { buildNewsWriteInput, newsEditorDraftSchema } from "./news-form-state"
import type { SavedNewsCommand } from "./news-command-state"

const envelope = z.object({
  version: z.literal(1),
  savedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  values: newsEditorDraftSchema,
})

export const clearConfirmedNewsDraft = (
  record: SavedNewsCommand,
  storage: Pick<Storage, "getItem" | "removeItem">
): void => {
  if (record.status !== "confirmed") return
  const key = `admin:news:${record.context.entryId}`
  const raw = storage.getItem(key)
  if (raw === null || new TextEncoder().encode(raw).length > 512 * 1_024) return
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  const parsed = envelope.safeParse(value)
  if (!parsed.success) return
  let input: ReturnType<typeof buildNewsWriteInput>
  try {
    input = buildNewsWriteInput(parsed.data.values, record.intent)
  } catch {
    return
  }
  const {
    content,
    coverAltText,
    coverUrl,
    excerpt,
    publishedAt,
    status,
    tags,
    title,
  } = record.body
  if (
    JSON.stringify(input) !==
    JSON.stringify({
      content,
      coverAltText,
      coverUrl,
      excerpt,
      publishedAt,
      status,
      tags,
      title,
    })
  )
    return
  // A different draft may have been saved by another tab. Only remove the
  // exact input acknowledged by this command; never discard newer edits.
  if (storage.getItem(key) !== raw) return
  storage.removeItem(key)
  if (storage.getItem(key) !== null)
    throw new Error(
      "The confirmed News draft could not be cleared. Keep its saved request."
    )
}
