export type HttpErrorDetails = {
  status: number
  code: string
  title: string
  detail: string
}

const readStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null
  }

  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof candidate.status === "number") {
    return candidate.status
  }
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode
  }
  return typeof candidate.response?.status === "number"
    ? candidate.response.status
    : null
}

const readMessage = (error: unknown): string | null =>
  error instanceof Error && error.message.trim() ? error.message.trim() : null

export const mapCartError = (
  error: unknown,
  fallbackDetail: string
): HttpErrorDetails => {
  const status = readStatus(error)
  const message = readMessage(error)
  const timedOut =
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")

  if (timedOut) {
    return {
      status: 504,
      code: "cart_upstream_timeout",
      title: "Cart request timed out",
      detail: "The cart service took too long to respond. Please try again.",
    }
  }

  if (status === 404) {
    return {
      status: 404,
      code: "cart_not_found",
      title: "Cart not found",
      detail: "This cart is no longer available.",
    }
  }
  if (status === 409) {
    return {
      status: 409,
      code: "cart_conflict",
      title: "Cart changed",
      detail: message ?? "The cart changed while this request was processed.",
    }
  }
  if (status === 400 || status === 422) {
    const inventoryRelated = Boolean(
      message?.match(/inventory|stock|available|quantity/i)
    )
    return {
      status: 422,
      code: inventoryRelated ? "inventory_unavailable" : "cart_invalid",
      title: inventoryRelated
        ? "Inventory unavailable"
        : "Cart update rejected",
      detail: message ?? fallbackDetail,
    }
  }
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      title: "Too many cart updates",
      detail: "Please wait a moment before trying again.",
    }
  }

  return {
    status: 500,
    code: "cart_unavailable",
    title: "Cart temporarily unavailable",
    detail: fallbackDetail,
  }
}
