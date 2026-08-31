import { z } from "zod"

import { asUnknownRecord } from "../../../lib/provider-boundary/records"
import {
  MAX_UPLOAD_FILES,
  MAX_NORMALIZED_IMAGE_BYTES,
} from "../../../lib/uploads/constraints"

const uploadFileSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  id: z.string().trim().min(1).max(1_024),
  mediaAssetId: z.string().trim().min(1).max(255),
  mimeType: z.literal("image/webp"),
  size: z.number().int().positive().max(MAX_NORMALIZED_IMAGE_BYTES),
  url: z.string().trim().url().max(2_048),
})

const uploadResponseSchema = z.object({
  files: z.array(uploadFileSchema).min(1).max(MAX_UPLOAD_FILES),
})

export type CatalogCreationUploadedFile = z.infer<typeof uploadFileSchema>

type UploadFetch = (input: string, init: RequestInit) => Promise<Response>

type UploadOptions = {
  fetcher?: UploadFetch
  signal?: AbortSignal
  timeoutMs?: number
}

const uploadErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `Image upload failed with status ${response.status}.`
  try {
    const body = await response.text()
    if (!body) {
      return fallback
    }
    const parsed: unknown = JSON.parse(body)
    const payload = asUnknownRecord(parsed)
    if (payload) {
      const message = payload.message
      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, 1_000)
      }
    }
    return body.trim().slice(0, 1_000) || fallback
  } catch {
    return fallback
  }
}

export const uploadCatalogCreationMedia = async (
  files: File[],
  {
    fetcher = globalThis.fetch.bind(globalThis),
    signal: externalSignal,
    timeoutMs = 120_000,
  }: UploadOptions = {}
): Promise<CatalogCreationUploadedFile[]> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Upload timeout must be a positive integer.")
  }
  const controller = new AbortController()
  let timedOut = false
  const abortFromExternal = (): void => {
    controller.abort(externalSignal?.reason)
  }
  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, {
      once: true,
    })
  }
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const formData = new FormData()
  files.forEach((file) => {
    formData.append("files", file)
  })
  formData.append("idempotencyKey", crypto.randomUUID())

  try {
    const response = await fetcher("/admin/catalog/media/uploads", {
      body: formData,
      credentials: "include",
      method: "POST",
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(await uploadErrorMessage(response))
    }
    return uploadResponseSchema.parse(await response.json()).files
  } catch (error) {
    if (timedOut) {
      throw new Error("The image upload took too long. Try again.", {
        cause: error,
      })
    }
    if (externalSignal?.aborted) {
      throw new Error("The image upload was cancelled.", { cause: error })
    }
    if (error instanceof z.ZodError) {
      throw new Error("The server returned an invalid image upload response.", {
        cause: error,
      })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortFromExternal)
  }
}
