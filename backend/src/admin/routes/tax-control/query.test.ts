import { requestAdminJson } from "../../lib/admin-request"
import {
  refreshTaxRateIoQuota,
  taxControlQueryOptions,
  taxControlSnapshotSchema,
  transitionTaxControl,
} from "./query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

const validSnapshot = {
  audits: [
    {
      acknowledgementVersion: "tax-collection-control-2026-08-30",
      actorId: "user_admin",
      createdAt: "2026-07-27T01:00:00.000Z",
      fromCollectionMode: "collect",
      fromGeneration: 1,
      fromProvider: "taxrate_io",
      id: "txpa_01",
      reason: "Stripe sandbox validation completed.",
      toCollectionMode: "collect",
      toGeneration: 2,
      toProvider: "stripe_tax",
    },
  ],
  control: {
    activeProvider: "stripe_tax",
    collectionMode: "collect",
    generation: 2,
    lastSwitchReason: "Stripe sandbox validation completed.",
    lastSwitchedAt: "2026-07-27T01:00:00.000Z",
    lastSwitchedBy: "user_admin",
  },
  evidence: {
    incidents: [
      {
        associationStatus: "refund_pending",
        currencyCode: "usd",
        id: "txqe_01",
        lastVerifiedAt: "2026-07-27T02:00:00.000Z",
        medusaRefundAmountMinor: null,
        orderId: "order_01",
        paymentIntentId: "pi_01",
        provider: "stripe_tax",
        status: "refund_pending",
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: null,
      },
    ],
    needsAttention: 0,
    pendingRefundReversals: 1,
    prepared: 1,
    refundLedger: {
      available: true,
      checked: 2,
      mismatches: 0,
      truncated: false,
    },
    refunds: 1,
    succeeded: 1,
    tracked: 2,
  },
  impact: {
    activityWindowDays: 30,
    frozenByCollectionMode: {
      collect: 3,
      disabled: 0,
    },
    frozenByProvider: {
      stripe_tax: 1,
      taxrate_io: 2,
    },
    paymentsFinalizing: 1,
    preparedCheckouts: 3,
  },
  providers: {
    stripeTax: {
      accountMode: "sandbox",
      activeRegistrationCount: 1,
      checks: [
        {
          detail: "Connected to the sandbox account.",
          id: "api_key",
          label: "Stripe key",
          ready: true,
        },
      ],
      configured: true,
      message: "Stripe Tax is ready in sandbox.",
      missingFields: [],
      ready: true,
    },
    taxRateIo: {
      checks: [
        {
          detail: "A TaxRate.io key is configured.",
          id: "api_key",
          label: "API key",
          ready: true,
        },
      ],
      configured: true,
      manualRefreshConfigured: true,
      message: "TaxRate.io can calculate US ZIP-code rates.",
      quota: {
        observedAt: "2026-07-27T02:00:00.000Z",
        quota: 100,
        remaining: 86,
        source: "checkout_lookup",
        usage: 14,
        usagePercent: 14,
      },
      ready: true,
    },
  },
} as const

describe("tax control query boundary", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset()
  })

  it("accepts the complete control, provider, impact, and evidence snapshot", () => {
    expect(taxControlSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot)
  })

  it("rejects malformed providers, money, and bounded counts", () => {
    expect(() =>
      taxControlSnapshotSchema.parse({
        ...validSnapshot,
        evidence: {
          ...validSnapshot.evidence,
          incidents: [
            {
              ...validSnapshot.evidence.incidents[0],
              currencyCode: "US",
              medusaRefundAmountMinor: -1,
            },
          ],
        },
        impact: {
          ...validSnapshot.impact,
          preparedCheckouts: -1,
        },
      })
    ).toThrow()
  })

  it("rejects impossible provider availability states", () => {
    expect(() =>
      taxControlSnapshotSchema.parse({
        ...validSnapshot,
        providers: {
          ...validSnapshot.providers,
          taxRateIo: {
            ...validSnapshot.providers.taxRateIo,
            configured: false,
            ready: true,
          },
        },
      })
    ).toThrow("unconfigured tax provider")
    expect(() =>
      taxControlSnapshotSchema.parse({
        ...validSnapshot,
        providers: {
          ...validSnapshot.providers,
          taxRateIo: {
            ...validSnapshot.providers.taxRateIo,
            checks: [
              {
                detail: "A required setting is missing.",
                id: "api_key",
                label: "API key",
                ready: false,
              },
            ],
          },
        },
      })
    ).toThrow("failed check")
  })

  it("forwards Query cancellation and uses a bounded freshness window", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue(validSnapshot)
    const options = taxControlQueryOptions()
    const controller = new AbortController()

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: options.queryKey,
        signal: controller.signal,
      })
    ).resolves.toEqual(validSnapshot)

    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/tax-control",
      schema: taxControlSnapshotSchema,
      signal: controller.signal,
      timeoutMs: 20_000,
    })
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.retry).toBe(false)
    expect(options.staleTime).toBe(30_000)
  })

  it("validates switch and quota-refresh responses through the same contract", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue(validSnapshot)
    const switchInput = {
      expectedGeneration: 1,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      reason: "Stripe sandbox validation completed.",
      targetCollectionMode: "collect",
      targetProvider: "stripe_tax",
    } as const

    await expect(transitionTaxControl(switchInput)).resolves.toEqual(
      validSnapshot
    )
    await expect(refreshTaxRateIoQuota()).resolves.toEqual(validSnapshot)

    expect(requestAdminJson).toHaveBeenNthCalledWith(1, {
      body: switchInput,
      method: "POST",
      path: "/admin/tax-control/switch",
      schema: taxControlSnapshotSchema,
      timeoutMs: 20_000,
    })
    expect(requestAdminJson).toHaveBeenNthCalledWith(2, {
      method: "POST",
      path: "/admin/tax-control/taxrate-io/refresh",
      schema: taxControlSnapshotSchema,
      timeoutMs: 20_000,
    })
  })
})
