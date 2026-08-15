import type { HttpTypes } from "@medusajs/types"

type StoreCart = HttpTypes.StoreCart

type CartResponse = { cart: StoreCart | null }

type ErrorResponse = {
  error?: string
  detail?: string
  title?: string
  code?: string
}

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

const requestJson = async <T>(
  input: RequestInfo,
  init?: RequestInit
): Promise<T> => {
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

    const retryAfter = Number(response.headers.get("Retry-After"))
    const shouldRetry =
      RETRYABLE_STATUSES.has(response.status) ||
      (response.status === 409 && Number.isFinite(retryAfter) && retryAfter > 0)
    if (
      shouldRetry &&
      attempt + 1 < CART_REQUEST_MAX_ATTEMPTS &&
      !init?.signal?.aborted
    ) {
      await response.body?.cancel().catch(() => undefined)
      await new Promise<void>((resolve) => {
        setTimeout(
          resolve,
          Number.isFinite(retryAfter) && retryAfter > 0
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
    const payload = (await response.json().catch(() => ({}))) as ErrorResponse
    const retryAfter = Number(response.headers.get("Retry-After"))
    throw new CartClientError(
      payload.detail ??
        payload.error ??
        payload.title ??
        `Request failed (${response.status})`,
      {
        status: response.status,
        code: payload.code ?? null,
        retryAfterSeconds:
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      }
    )
  }

  return response.json() as Promise<T>
}

export const getCart = async (): Promise<StoreCart | null> =>
  (await requestJson<CartResponse>("/api/cart")).cart

export const addLineItem = async (
  variantId: string,
  quantity: number
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({ variant_id: variantId, quantity }),
  })

  if (!payload.cart) {
    throw new CartClientError("Cart response missing after adding item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return payload.cart
}

export const updateLineItem = async (
  lineItemId: string,
  quantity: number
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/items/${lineItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    }
  )

  if (!payload.cart) {
    throw new CartClientError("Cart response missing after updating item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return payload.cart
}

export const removeLineItem = async (
  lineItemId: string
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/items/${lineItemId}`,
    { method: "DELETE" }
  )

  if (!payload.cart) {
    throw new CartClientError("Cart response missing after removing item.", {
      status: 502,
      code: "cart_response_missing",
    })
  }
  return payload.cart
}
