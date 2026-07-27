import { FetchError, type Client, type FetchArgs } from "@medusajs/js-sdk"
import { z, type ZodType } from "zod"

import { sdk } from "./sdk"

const DEFAULT_TIMEOUT_MS = 15_000

export type AdminRequestFailureKind =
  | "cancelled"
  | "http"
  | "invalid-response"
  | "timeout"
  | "unknown"

export class AdminRequestError extends Error {
  readonly kind: AdminRequestFailureKind
  readonly status: number | undefined

  constructor(
    message: string,
    kind: AdminRequestFailureKind,
    status?: number,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = "AdminRequestError"
    this.kind = kind
    this.status = status
  }
}

export type AdminSdkClient = Pick<Client, "fetch">

export type AdminJsonRequestOptions<T> = {
  body?: FetchArgs["body"]
  client?: AdminSdkClient
  method?: string
  path: string
  query?: FetchArgs["query"]
  schema: ZodType<T>
  signal?: AbortSignal
  timeoutMs?: number
}

const assertTimeout = (timeoutMs: number): void => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Admin request timeout must be a positive integer")
  }
}

export const requestAdminJson = async <T>({
  body,
  client = sdk.client,
  method = "GET",
  path,
  query,
  schema,
  signal: externalSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AdminJsonRequestOptions<T>): Promise<T> => {
  assertTimeout(timeoutMs)

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

  const request: FetchArgs = {
    method,
    signal: controller.signal,
  }
  if (body !== undefined) {
    request.body = body
  }
  if (query !== undefined) {
    request.query = query
  }

  try {
    const payload = await client.fetch<unknown>(path, request)
    return schema.parse(payload)
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new AdminRequestError(
        "The request was cancelled.",
        "cancelled",
        undefined,
        error,
      )
    }
    if (timedOut) {
      throw new AdminRequestError(
        "The request took too long. Try again.",
        "timeout",
        undefined,
        error,
      )
    }
    if (error instanceof FetchError) {
      throw new AdminRequestError(
        error.message || "The request failed.",
        "http",
        error.status,
        error,
      )
    }
    if (error instanceof z.ZodError) {
      throw new AdminRequestError(
        "The server returned an unexpected response.",
        "invalid-response",
        undefined,
        error,
      )
    }
    throw new AdminRequestError(
      error instanceof Error ? error.message : "The request failed.",
      "unknown",
      undefined,
      error,
    )
  } finally {
    globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortFromExternal)
  }
}

export const getAdminRequestErrorMessage = (
  error: unknown,
  fallback: string,
): string => (error instanceof Error ? error.message : fallback)
