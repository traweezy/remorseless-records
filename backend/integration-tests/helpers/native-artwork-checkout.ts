import type { IPaymentModuleService } from "@medusajs/framework/types"
import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider"
import type Stripe from "stripe"
import { createRequire } from "node:module"
import { join } from "node:path"

type ProviderBoundary = {
  create: (input: { id: string; is_enabled: boolean }[]) => Promise<unknown>
  retrieveProvider: (id: string) => unknown
}

/**
 * Keep the installed Stripe adapter, SDK serialization and native Payment
 * persistence. Only SDK HTTP transport is synthetic; it never opens a socket.
 * Provider lookup is extended only for this disposable database/test lifetime.
 */
export const installDisposableStripeTransport = async (
  payments: IPaymentModuleService
) => {
  const requireFromBackend = createRequire(join(process.cwd(), "package.json"))
  const requireFromProvider = createRequire(
    requireFromBackend.resolve("@medusajs/payment-stripe")
  )
  const NativeStripe = requireFromProvider("stripe") as typeof Stripe
  const intents = new Map<string, Record<string, unknown>>()
  const requests: { method: string; path: string }[] = []
  const unexpectedRequests: string[] = []
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input))
    const method = options?.method ?? "GET"
    requests.push({ method, path: url.pathname })
    const intentId = url.pathname.match(
      /^\/v1\/payment_intents\/(pi_disposable_\d+)$/u
    )?.[1]
    let result: Record<string, unknown> | undefined
    if (
      url.origin === "https://api.stripe.com" &&
      method === "POST" &&
      url.pathname === "/v1/payment_intents"
    ) {
      const form = new URLSearchParams(String(options?.body))
      const metadata: Record<string, string> = {}
      for (const [key, value] of form) {
        const name = key.match(/^metadata\[([^\]]+)\]$/u)?.[1]
        if (name) metadata[name] = value
      }
      const id = `pi_disposable_${intents.size + 1}`
      result = {
        id,
        object: "payment_intent",
        amount: Number(form.get("amount")),
        currency: form.get("currency"),
        metadata,
        status: "requires_payment_method",
        client_secret: `${id}_secret_synthetic`,
        payment_method: null,
        capture_method: form.get("capture_method"),
        livemode: false,
      }
      intents.set(id, result)
    } else if (
      url.origin === "https://api.stripe.com" &&
      method === "GET" &&
      intentId
    ) {
      result = intents.get(intentId)
    }
    if (!result) {
      unexpectedRequests.push(`${method} ${url.origin}${url.pathname}`)
      throw new Error("Unexpected disposable Stripe transport request")
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "req_disposable_artwork",
      },
    })
  }
  const provider = new StripeProviderService(
    {},
    {
      apiKey: "sk_test_disposable_transport",
      webhookSecret: "whsec_disposable_transport",
      capture: true,
    }
  )
  Object.defineProperty(provider, "stripe_", {
    value: new NativeStripe("sk_test_disposable_transport", {
      httpClient: NativeStripe.createFetchHttpClient(fetcher),
      maxNetworkRetries: 0,
      timeout: 2_000,
      telemetry: false,
    }),
  })
  const boundary = (
    payments as IPaymentModuleService & {
      paymentProviderService_: ProviderBoundary
    }
  ).paymentProviderService_
  await boundary.create([{ id: "pp_stripe_stripe", is_enabled: true }])
  const original = boundary.retrieveProvider.bind(boundary)
  const lookup = jest
    .spyOn(boundary, "retrieveProvider")
    .mockImplementation((id) =>
      id === "pp_stripe_stripe" ? provider : original(id)
    )
  return {
    requests,
    unexpectedRequests,
    confirm: (id: unknown) => {
      if (typeof id !== "string" || !intents.has(id))
        throw new Error("Disposable confirmation must own its PaymentIntent")
      intents.get(id)!.status = "succeeded"
    },
    restore: () => lookup.mockRestore(),
  }
}
