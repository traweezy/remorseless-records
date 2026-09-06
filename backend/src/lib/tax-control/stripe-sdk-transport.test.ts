import Stripe from "stripe"

import {
  createStripeEvidenceReader,
  StripeEvidenceClientError,
} from "./stripe-evidence-client"
import { verifyAndLinkStripePayment } from "./stripe-payment-binding-client"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"
const metadata = {
  medusa_cart_id: "cart_01TEST",
  rr_tax_calculation_id: "taxcalc_test",
  rr_tax_fingerprint: fingerprint,
  rr_tax_generation: "2",
  rr_tax_provider: "stripe_tax",
}
const intent = {
  amount: 1080,
  currency: "usd",
  hooks: null,
  id: "pi_test",
  livemode: false,
  metadata,
  object: "payment_intent",
  status: "requires_payment_method",
}
const linkedIntent = {
  ...intent,
  hooks: { inputs: { tax: { calculation: "taxcalc_test" } } },
}
const calculation = {
  amount_total: 1080,
  currency: "usd",
  expires_at: 4_000_000_000,
  id: "taxcalc_test",
  livemode: false,
  object: "tax.calculation",
}

// Deliberately permit SDK retries here: owned request options must override them.
// The injected Fetch transport never delegates to global fetch or a live provider.
const createClient = (fetcher: typeof fetch): Stripe =>
  new Stripe("sk_test_transport_fixture", {
    httpClient: Stripe.createFetchHttpClient(fetcher),
    maxNetworkRetries: 3,
  })

const verify = (
  client: Stripe,
  onRetry = jest.fn()
): ReturnType<typeof verifyAndLinkStripePayment> =>
  verifyAndLinkStripePayment({
    amountMinor: 1080,
    calculationId: "taxcalc_test",
    cartId: "cart_01TEST",
    client,
    collectionMode: "collect",
    currencyCode: "usd",
    fingerprint,
    generation: 2,
    onRetry,
    paymentIntentId: "pi_test",
    provider: "stripe_tax",
    taxRatePercent: null,
    timeoutMs: 8_000,
  })

type CapturedRequest = {
  body: string
  headers: Headers
  method: string
  path: string
}

const bindingTransport = ({ retryUpdate = false } = {}) => {
  const requests: CapturedRequest[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    expect(url.origin).toBe("https://api.stripe.com")
    requests.push({
      body: await request.text(),
      headers: request.headers,
      method: request.method,
      path: url.pathname,
    })
    if (
      request.method === "GET" &&
      url.pathname === "/v1/payment_intents/pi_test"
    ) {
      return Response.json(intent)
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/tax/calculations/taxcalc_test"
    ) {
      return Response.json(calculation)
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/payment_intents/pi_test"
    ) {
      if (
        retryUpdate &&
        requests.filter(({ method }) => method === "POST").length === 1
      ) {
        return Response.json(
          {
            error: {
              message: "private provider diagnostic",
              type: "api_error",
            },
          },
          { status: 503, headers: { "request-id": "req_private" } }
        )
      }
      return Response.json(linkedIntent)
    }
    throw new Error("Unexpected Stripe fixture request")
  }
  return { client: createClient(fetcher), requests }
}

describe("owned Stripe clients with the real SDK Fetch transport", () => {
  it("sends the SDK API version and exact tax-link form with stable idempotency", async () => {
    const { client, requests } = bindingTransport()

    await expect(verify(client)).resolves.toEqual({
      linkedNow: true,
      livemode: false,
      previouslyLinked: false,
      status: "requires_payment_method",
    })

    expect(requests).toHaveLength(3)
    for (const request of requests) {
      expect(request.headers.get("stripe-version")).toBe("2026-08-26.dahlia")
      expect(request.headers.get("authorization")).toBe(
        "Bearer sk_test_transport_fixture"
      )
    }
    const update = requests.find(({ method }) => method === "POST")
    expect(update?.headers.get("idempotency-key")).toBe(
      `rr-tax-link-pi_test-${fingerprint}`
    )
    expect(update?.headers.get("content-type")).toContain(
      "application/x-www-form-urlencoded"
    )
    expect(Object.fromEntries(new URLSearchParams(update?.body))).toEqual({
      "hooks[inputs][tax][calculation]": "taxcalc_test",
      "metadata[medusa_cart_id]": "cart_01TEST",
      "metadata[rr_tax_calculation_id]": "taxcalc_test",
      "metadata[rr_tax_collection_mode]": "collect",
      "metadata[rr_tax_fingerprint]": fingerprint,
      "metadata[rr_tax_generation]": "2",
      "metadata[rr_tax_provider]": "stripe_tax",
    })
  })

  it("leaves retries to the owned boundary and preserves the update idempotency key", async () => {
    const { client, requests } = bindingTransport({ retryUpdate: true })
    const onRetry = jest.fn()

    await expect(verify(client, onRetry)).resolves.toMatchObject({
      linkedNow: true,
    })

    expect(requests).toHaveLength(4)
    const updates = requests.filter(({ method }) => method === "POST")
    expect(updates).toHaveLength(2)
    expect(
      updates.map(({ headers }) => headers.get("idempotency-key"))
    ).toEqual([
      `rr-tax-link-pi_test-${fingerprint}`,
      `rr-tax-link-pi_test-${fingerprint}`,
    ])
    expect(updates[0]?.body).toBe(updates[1]?.body)
    expect(onRetry.mock.calls).toEqual([
      [
        {
          attempt: 2,
          operation: "update_intent",
          reason: "status",
          totalAttempts: 2,
        },
      ],
    ])
  })

  it.each(["invalid JSON", "interrupted body"])(
    "sanitizes %s returned after successful response headers",
    async (failure) => {
      const onRetry = jest.fn()
      const fetcher = jest.fn<
        ReturnType<typeof fetch>,
        Parameters<typeof fetch>
      >(async () => {
        if (failure === "invalid JSON") {
          return new Response('{"customer":"private@example.test",')
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) =>
              controller.error(
                new Error("private@example.test response disconnected")
              ),
          })
        )
      })
      const reader = createStripeEvidenceReader({
        client: createClient(fetcher),
        onRetry,
        timeoutMs: 8_000,
      })

      await expect(reader.readIntent("pi_test")).rejects.toEqual(
        new StripeEvidenceClientError("provider_unavailable")
      )
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(onRetry).not.toHaveBeenCalled()
    }
  )

  it("redacts provider error bodies and request identifiers at the owned boundary", async () => {
    const onRetry = jest.fn()
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
      async () =>
        Response.json(
          {
            error: {
              message: "private@example.test sk_test_transport_fixture",
              type: "invalid_request_error",
            },
          },
          { status: 400, headers: { "request-id": "req_private" } }
        )
    )
    const reader = createStripeEvidenceReader({
      client: createClient(fetcher),
      onRetry,
      timeoutMs: 8_000,
    })
    const error: unknown = await reader
      .readIntent("pi_test")
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(StripeEvidenceClientError)
    expect(error).toMatchObject({
      code: "provider_rejected",
      message: "Stripe evidence read failed (provider_rejected).",
    })
    expect(JSON.stringify(error)).not.toMatch(/private|sk_test|req_/)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it("keeps the SDK deadline armed until a stalled response body finishes", async () => {
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    let requestSignal: AbortSignal | null | undefined
    let abortBody: (() => void) | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const onRetry = jest.fn()
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
      async (_input, init) => {
        requestSignal = init?.signal
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            bodyController = controller
            controller.enqueue(new TextEncoder().encode('{"id":"pi_test",'))
            // A real Fetch response body rejects when its request is aborted.
            abortBody = () => controller.error(requestSignal?.reason)
            requestSignal?.addEventListener("abort", abortBody, { once: true })
          },
        })
        return new Response(body, {
          headers: { "request-id": "req_private_body" },
        })
      }
    )
    const reader = createStripeEvidenceReader({
      client: createClient(fetcher),
      onRetry,
      timeoutMs: 100,
    })
    const result = reader.readIntent("pi_test").then(
      (value) => ({ kind: "success" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error })
    )
    try {
      const outcome = await Promise.race([
        result,
        new Promise<{ kind: "watchdog" }>((resolve) => {
          watchdog = setTimeout(() => resolve({ kind: "watchdog" }), 1_000)
        }),
      ])
      expect(outcome.kind).toBe("error")
      if (outcome.kind !== "error")
        throw new Error("Stripe response body exceeded its owned deadline")
      expect(outcome.error).toBeInstanceOf(StripeEvidenceClientError)
      expect(outcome.error).toMatchObject({ code: "deadline_exceeded" })
      expect(requestSignal?.aborted).toBe(true)
      expect(JSON.stringify(outcome.error)).not.toContain("req_private_body")
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(onRetry.mock.calls).toEqual([
        [
          {
            attempt: 2,
            operation: "retrieve_intent",
            reason: "transport",
            totalAttempts: 2,
          },
        ],
      ])
    } finally {
      clearTimeout(watchdog)
      if (abortBody) requestSignal?.removeEventListener("abort", abortBody)
      bodyController?.error(new Error("Fixture cleanup"))
      await result
    }
  })
})
