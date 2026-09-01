import type { HttpTypes } from "@medusajs/types"

import { asUnknownRecord, readBoundedText } from "@/lib/provider-boundary"

import { cartEnvelopeFrom, CartSnapshotError } from "./snapshot"

type StoreCart = HttpTypes.StoreCart

const CART_REQUEST_TIMEOUT_MS = 10_000
const CART_REQUEST_MAX_ATTEMPTS = 2
const CART_RETRY_DELAY_MS = 150
const RETRYABLE_STATUSES = new Set([502, 503, 504])

export class CartClientError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    options: {
      status: number
      code?: string | null
      retryAfterSeconds?: number | null
    }
  ) {
    super(message)
    this.name = "CartClientError"
    this.status = options.status
    this.code = options.code ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

const createRequestSignal = (signal?: AbortSignal | null): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(CART_REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

const retryAfterSecondsFrom = (value: string | null): number | null => {
  if (!value || !/^[1-9]\d*$/.test(value.trim())) {
    return null
  }
  const seconds = Number(value.trim())
  return Number.isSafeInteger(seconds) ? seconds : null
}

const errorResponseFrom = (
  value: unknown
): { code: string | null; message: string | null } => {
  const payload = asUnknownRecord(value)
  const code = readBoundedText(payload?.code, 64)
  const safeCode = code && /^[a-z0-9_]{3,64}$/.test(code) ? code : null
  const message = [payload?.detail, payload?.error, payload?.title]
    .map((candidate) => readBoundedText(candidate, 512))
    .find((candidate): candidate is string => candidate !== null)
  return { code: safeCode, message: message ?? null }
}

const requestJson = async (
  input: RequestInfo,
  init?: RequestInit
): Promise<unknown> => {
  const method = init?.method?.toUpperCase() ?? "GET"
  const headers = new Headers(init?.headers)
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (!headers.has("X-Request-ID")) {
    headers.set("X-Request-ID", crypto.randomUUID())
  }
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    !headers.has("Idempotency-Key")
  ) {
    headers.set("Idempotency-Key", crypto.randomUUID())
  }
  let response: Response | null = null
  let lastNetworkError: unknown

  for (let attempt = 0; attempt < CART_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(input, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "same-origin",
        signal: createRequestSignal(init?.signal),
      })
    } catch (error: unknown) {
      lastNetworkError = error
      if (attempt + 1 < CART_REQUEST_MAX_ATTEMPTS && !init?.signal?.aborted) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, CART_RETRY_DELAY_MS)
        })
        continue
      }
      break
    }

    const retryAfter = retryAfterSecondsFrom(
      response.headers.get("Retry-After")
    )
    const shouldRetry =
      RETRYABLE_STATUSES.has(response.status) ||
      (response.status === 409 && retryAfter !== null)
    if (
      shouldRetry &&
      attempt + 1 < CART_REQUEST_MAX_ATTEMPTS &&
      !init?.signal?.aborted
    ) {
      await response.body?.cancel().catch(() => undefined)
      await new Promise<void>((resolve) => {
        setTimeout(
          resolve,
          retryAfter !== null
            ? Math.min(retryAfter * 1_000, CART_REQUEST_TIMEOUT_MS)
            : CART_RETRY_DELAY_MS
        )
      })
      continue
    }
    break
  }

  if (!response) {
    const timedOut =
      lastNetworkError instanceof DOMException &&
      (lastNetworkError.name === "TimeoutError" ||
        lastNetworkError.name === "AbortError")
    throw new CartClientError(
      timedOut
        ? "The cart request timed out. Please try again."
        : "Unable to reach the cart service.",
      {
        status: 0,
        code: timedOut ? "request_timeout" : "network_error",
      }
    )
  }

  if (!response.ok) {
    const rawPayload: unknown = await response.json().catch(() => undefined)
    const payload = errorResponseFrom(rawPayload)
    const retryAfter = retryAfterSecondsFrom(
      response.headers.get("Retry-After")
    )
    throw new CartClientError(
      payload.message ?? `Request failed (${response.status})`,
      {
        status: response.status,
        code: payload.code ?? null,
        retryAfterSeconds: retryAfter,
      }
    )
  }

  const payload: unknown = await response.json()
  return payload
}

const requestCart = async (
  input: RequestInfo,
  init?: RequestInit
): Promise<StoreCart | null> => {
  try {
    return cartEnvelopeFrom(await requestJson(input, init)).cart
  } catch (error: unknown) {
    if (error instanceof CartClientError) {
      throw error
    }
    throw new CartClientError(
      error instanceof CartSnapshotError
        ? "The cart service returned an invalid response."
        : "Unable to read the cart response.",
      { status: 502, code: "cart_response_invalid" }
    )
  }
}

export const getCart = async (): Promise<StoreCart | null> =>
  requestCart("/api/cart")

export const addLineItem = async (
  variantId: string,
  quantity: number
): Promise<StoreCart> => {
  const cart = await requestCart("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ variant_id: variantId, quantity }),
  })

  if (!cart) {
    throw new CartClientError("Cart response missing after adding item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return cart
}

export const updateLineItem = async (
  lineItemId: string,
  quantity: number
): Promise<StoreCart> => {
  const cart = await requestCart(`/api/cart/items/${lineItemId}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity }),
  })

  if (!cart) {
    throw new CartClientError("Cart response missing after updating item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return cart
}

export const removeLineItem = async (
  lineItemId: string
): Promise<StoreCart> => {
  const cart = await requestCart(`/api/cart/items/${lineItemId}`, {
    method: "DELETE",
  })

  if (!cart) {
    throw new CartClientError("Cart response missing after removing item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return cart
}
