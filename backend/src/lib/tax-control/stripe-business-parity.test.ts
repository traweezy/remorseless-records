import Stripe from "stripe"

import {
  readStripeBusinessParity,
  type StripeBusinessParityRecord,
} from "./stripe-business-parity"
import type {
  StripeEvidenceClient,
  StripeEvidenceReader,
} from "./stripe-evidence-client"

const records: StripeBusinessParityRecord[] = [
  {
    paymentIntentId: "pi_first",
    medusaAmountMajor: "6.53",
    medusaCurrencyCode: "usd",
    providerAmountMinor: 653,
    providerCurrencyCode: "usd",
    taxAmountMinor: 653,
    taxCurrencyCode: "usd",
  },
  {
    paymentIntentId: "pi_second",
    medusaAmountMajor: "9.7000",
    medusaCurrencyCode: "usd",
    providerAmountMinor: 970,
    providerCurrencyCode: "usd",
    taxAmountMinor: null,
    taxCurrencyCode: null,
  },
]

const intent = (id: string) => ({
  amountMinor: id === "pi_first" ? 653 : 971,
  amountReceived: id === "pi_first" ? 653 : 971,
  charge: null,
  currencyCode: "usd",
  id,
  lastPaymentErrorCode: null,
  livemode: false,
  orderId: null,
  status: "succeeded" as const,
})

const dependencies = () => {
  const retrieveCurrent = jest.fn().mockResolvedValue({
    id: "acct_expected",
    object: "account",
  })
  const readIntent = jest
    .fn()
    .mockImplementation(async (id: string) => intent(id))
  return {
    client: {
      accounts: { retrieveCurrent },
    } as unknown as StripeEvidenceClient & Pick<Stripe, "accounts">,
    reader: {
      readIntentSummary: readIntent,
    } as unknown as StripeEvidenceReader,
    readIntent,
    retrieveCurrent,
  }
}

describe("bounded Stripe business parity", () => {
  it("reads exact intents serially and emits counts with account verification", async () => {
    const deps = dependencies()
    const result = await readStripeBusinessParity({
      apiKey: "sk_test_private",
      expectedAccountId: "acct_expected",
      records,
      ...deps,
    })

    expect(result).toEqual({
      schemaVersion: 1,
      source: "provided_private_descriptor_and_stripe_test_mode",
      readOnly: true,
      accountVerified: true,
      testModeVerified: true,
      businessReconciled: false,
      scanned: {
        paymentIntents: 2,
        taxEvidencePairs: 1,
        missingTaxEvidence: 1,
        archivedProviderAmounts: 2,
        archivedProviderCurrencies: 2,
      },
      mismatches: {
        medusaAmount: 1,
        medusaCurrency: 0,
        providerAmount: 1,
        providerCurrency: 0,
        taxAmount: 0,
        taxCurrency: 0,
      },
    })
    expect(deps.retrieveCurrent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      })
    )
    expect(deps.readIntent.mock.calls.map(([id]) => id)).toEqual([
      "pi_first",
      "pi_second",
    ])
    expect(JSON.stringify(result)).not.toContain("pi_first")
    expect(JSON.stringify(result)).not.toContain("acct_expected")
    expect(JSON.stringify(result)).not.toContain("653")
  })

  it("rejects an unanchored account before any network read", async () => {
    const deps = dependencies()
    await expect(
      readStripeBusinessParity({
        apiKey: "rk_test_private",
        expectedAccountId: "",
        records,
        ...deps,
      })
    ).rejects.toThrow("Invalid Stripe business parity account expectation.")
    expect(deps.retrieveCurrent).not.toHaveBeenCalled()
  })

  it("rejects malformed account responses and redacts account read failures", async () => {
    const deps = dependencies()
    deps.retrieveCurrent.mockResolvedValueOnce(null)
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Invalid Stripe business parity account response.")
    deps.retrieveCurrent.mockRejectedValueOnce(
      new Error("private acct_expected sk_test_private")
    )
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Stripe business parity account read failed.")
    expect(deps.readIntent).not.toHaveBeenCalled()
  })

  it("uses Medusa's four-decimal USD rounding and counts tax/currency drift", async () => {
    const deps = dependencies()
    const rounded = await readStripeBusinessParity({
      apiKey: "sk_test_private",
      expectedAccountId: "acct_expected",
      records: [
        { ...records[0]!, medusaAmountMajor: "6.5325", taxAmountMinor: 654 },
      ],
      ...deps,
    })
    expect(rounded.mismatches.medusaAmount).toBe(0)
    expect(rounded.mismatches.taxAmount).toBe(1)

    deps.readIntent.mockResolvedValueOnce({
      ...intent("pi_first"),
      currencyCode: "eur",
    })
    const drift = await readStripeBusinessParity({
      apiKey: "sk_test_private",
      expectedAccountId: "acct_expected",
      records: [records[0]!],
      ...deps,
    })
    expect(drift.mismatches).toMatchObject({
      medusaCurrency: 1,
      providerCurrency: 1,
      taxCurrency: 1,
    })
  })

  it("reports missing archived provider coverage explicitly", async () => {
    const deps = dependencies()
    const result = await readStripeBusinessParity({
      apiKey: "sk_test_private",
      expectedAccountId: "acct_expected",
      records: [
        {
          ...records[0]!,
          providerAmountMinor: null,
          providerCurrencyCode: null,
        },
      ],
      ...deps,
    })
    expect(result.scanned.archivedProviderAmounts).toBe(0)
    expect(result.scanned.archivedProviderCurrencies).toBe(0)
    expect(result.mismatches.providerAmount).toBe(0)
  })

  it("fails closed before intent reads for wrong account or live key", async () => {
    const deps = dependencies()
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_other",
        records,
        ...deps,
      })
    ).rejects.toThrow("Stripe business parity account mismatch.")
    expect(deps.readIntent).not.toHaveBeenCalled()
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_live_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Stripe business parity requires a test-mode key.")
  })

  it("rejects live objects and redacts provider failures", async () => {
    const deps = dependencies()
    deps.readIntent.mockResolvedValueOnce({
      ...intent("pi_first"),
      livemode: true,
    })
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Stripe business parity requires test-mode objects.")
    deps.readIntent
      .mockReset()
      .mockRejectedValue(new Error("private pi_first sk_test_private"))
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Stripe business parity provider read failed.")
  })

  it("rejects malformed intent responses and a spent shared deadline", async () => {
    const deps = dependencies()
    deps.readIntent.mockResolvedValueOnce({
      ...intent("pi_first"),
      amountMinor: -1,
    })
    await expect(
      readStripeBusinessParity({
        apiKey: "sk_test_private",
        expectedAccountId: "acct_expected",
        records,
        ...deps,
      })
    ).rejects.toThrow("Invalid Stripe business parity intent response.")

    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_001)
      .mockReturnValueOnce(1_031)
    try {
      const deadlineDeps = dependencies()
      await expect(
        readStripeBusinessParity({
          apiKey: "sk_test_private",
          expectedAccountId: "acct_expected",
          records,
          timeoutMs: 30,
          ...deadlineDeps,
        })
      ).rejects.toThrow("Stripe business parity deadline exceeded.")
      expect(deadlineDeps.readIntent).toHaveBeenCalledTimes(1)
    } finally {
      now.mockRestore()
    }

    const preReadNow = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_031)
    try {
      const preReadDeps = dependencies()
      await expect(
        readStripeBusinessParity({
          apiKey: "sk_test_private",
          expectedAccountId: "acct_expected",
          records,
          timeoutMs: 30,
          ...preReadDeps,
        })
      ).rejects.toThrow("Stripe business parity deadline exceeded.")
      expect(preReadDeps.readIntent).not.toHaveBeenCalled()
    } finally {
      preReadNow.mockRestore()
    }
  })

  it("uses the SDK's account GET with options outside query parameters", async () => {
    const requests: Request[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return Response.json(
        new URL(request.url).pathname === "/v1/account"
          ? { id: "acct_expected", object: "account" }
          : {
              id: "pi_first",
              object: "payment_intent",
              amount: 653,
              currency: "usd",
              livemode: false,
            }
      )
    }
    const client = new Stripe("sk_test_transport_fixture", {
      httpClient: Stripe.createFetchHttpClient(fetcher),
      maxNetworkRetries: 3,
    })
    await readStripeBusinessParity({
      apiKey: "sk_test_transport_fixture",
      client,
      expectedAccountId: "acct_expected",
      records: [records[0]!],
    })
    expect(requests).toHaveLength(2)
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/account")
    expect(new URL(requests[0]!.url).search).toBe("")
    expect(requests[0]!.method).toBe("GET")
    expect(new URL(requests[1]!.url).pathname).toBe(
      "/v1/payment_intents/pi_first"
    )
    expect(new URL(requests[1]!.url).search).toBe("")
    expect(requests[1]!.method).toBe("GET")
  })

  it("rejects duplicate, malformed, and over-cap private descriptors", async () => {
    const deps = dependencies()
    const invalid = [
      [...records, records[0]!],
      [{ ...records[0]!, paymentIntentId: "bad" }],
      [{ ...records[0]!, taxCurrencyCode: null }],
      [{ ...records[0]!, medusaAmountMajor: "6.53251" }],
      [{ ...records[0]!, medusaAmountMajor: "-6.53" }],
      [{ ...records[0]!, medusaAmountMajor: "0" }],
      [{ ...records[0]!, medusaCurrencyCode: "jpy" }],
      [{ ...records[0]!, unexpected: "field" }],
      Array.from({ length: 8 }, (_, index) => ({
        ...records[0]!,
        paymentIntentId: `pi_${index}`,
      })),
    ]
    for (const candidate of invalid) {
      await expect(
        readStripeBusinessParity({
          apiKey: "sk_test_private",
          expectedAccountId: "acct_expected",
          records: candidate,
          ...deps,
        })
      ).rejects.toThrow("Invalid Stripe business parity descriptor.")
    }
    expect(deps.retrieveCurrent).not.toHaveBeenCalled()
  })
})
