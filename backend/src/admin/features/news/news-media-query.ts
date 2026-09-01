import { z } from "zod"

import { asUnknownRecord } from "../../../lib/provider-boundary/records"
import {
  MANAGED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from "../../../lib/uploads/constraints"

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const managedUploadResponseSchema = z.object({
  files: z
    .array(
      z.object({
        url: z.string().trim().url().max(2_000).refine(isHttpUrl),
      })
    )
    .min(1),
})

const imageTypes = new Set<string>(MANAGED_IMAGE_MIME_TYPES)

export const validateNewsCover = (file: File): string | null => {
  if (!imageTypes.has(file.type)) {
    return "Choose a JPEG, PNG, WebP, or non-animated GIF image."
  }
  if (file.size <= 0) {
    return "The selected image is empty."
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "The selected image must be 12 MiB or smaller."
  }
  return null
}

type UploadNewsCoverOptions = {
  fetcher?: typeof globalThis.fetch
  signal?: AbortSignal
  timeoutMs?: number
}

const uploadFailureMessage = async (response: Response): Promise<string> => {
  const fallback = `Cover upload failed with status ${response.status}.`
  try {
    const payload: unknown = await response.json()
    const payloadRecord = asUnknownRecord(payload)
    if (payloadRecord) {
      const message = payloadRecord.message
      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, 1_000)
      }
    }
  } catch {
    // The status fallback is more useful than an invalid response body.
  }
  return fallback
}

export const uploadNewsCover = async (
  file: File,
  {
    fetcher = globalThis.fetch.bind(globalThis),
    signal: externalSignal,
    timeoutMs = 120_000,
  }: UploadNewsCoverOptions = {}
): Promise<string> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Upload timeout must be a positive integer.")
  }
  const validationError = validateNewsCover(file)
  if (validationError) {
    throw new Error(validationError)
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true })
  }
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const body = new FormData()
  body.append("files", file)

  try {
    const response = await fetcher("/admin/managed-uploads", {
      body,
      credentials: "include",
      method: "POST",
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(await uploadFailureMessage(response))
    }
    const payload: unknown = await response.json()
    const parsed = managedUploadResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error("The server returned an invalid cover upload response.")
    }
    return parsed.data.files[0]?.url ?? ""
  } catch (error) {
    if (timedOut) {
      throw new Error("The cover upload took too long. Try again.", {
        cause: error,
      })
    }
    if (externalSignal?.aborted) {
      throw new Error("The cover upload was cancelled.", { cause: error })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortFromExternal)
  }
}
