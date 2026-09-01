import type {
  ItemTaxCalculationLine,
  Logger,
  ShippingTaxCalculationLine,
  TaxCalculationContext,
} from "@medusajs/framework/types"

jest.mock("../../lib/constants", () => ({
  REDIS_URL: "",
}))
jest.mock("./clients/taxrate-io", () => ({
  fetchTaxRateIo: jest.fn(),
}))
jest.mock("./clients/stripe-tax", () => ({
  createStripeTaxCalculation: jest.fn(),
  retrieveStripeTaxCalculation: jest.fn(),
}))

import { createTaxContextFingerprint } from "../../lib/tax-control/context"
import {
  createStripeTaxCalculation,
  retrieveStripeTaxCalculation,
} from "./clients/stripe-tax"
import { fetchTaxRateIo } from "./clients/taxrate-io"
import TaxRateLookupProviderService from "./service"

const mockFetchTaxRateIo = jest.mocked(fetchTaxRateIo)
const mockCreateStripeTaxCalculation = jest.mocked(createStripeTaxCalculation)
const mockRetrieveStripeTaxCalculation = jest.mocked(
  retrieveStripeTaxCalculation
)

const service = (options: { apiKey?: string; stripeApiKey?: string } = {}) =>
  new TaxRateLookupProviderService(
    {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      } as unknown as Logger,
    },
    {
      apiKey: options.apiKey ?? "",
      provider: "taxrate_io",
      ...(options.stripeApiKey ? { stripeApiKey: options.stripeApiKey } : {}),
    }
  )

const item = (id: string): ItemTaxCalculationLine =>
  ({
    line_item: {
      currency_code: "usd",
      id,
      quantity: 1,
      unit_price: 20,
    },
  }) as unknown as ItemTaxCalculationLine

const shipping = (id: string): ShippingTaxCalculationLine =>
  ({
    shipping_line: {
      id,
      unit_price: 5,
    },
  }) as unknown as ShippingTaxCalculationLine

const context = (
  preservedItemRates: Record<string, number>,
  preservedShippingRates: Record<string, number>
): TaxCalculationContext =>
  ({
    additional_context: {
      remorseless_tax: {
        collectionMode: "collect",
        fingerprint: createTaxContextFingerprint({ order: "order_01" }),
        frozenQuote: {
          collectionMode: "collect",
          generation: 2,
          provider: "stripe_tax",
          stripeCalculationId: "taxcalc_original",
        },
        generation: 2,
        itemAmountsMinor: {},
        itemTaxCodes: {},
        preservedItemRates,
        preservedShippingRates,
        provider: "stripe_tax",
        shippingAmountMinor: 500,
        subjectId: "order_01",
      },
    },
    address: {
      country_code: "us",
      postal_code: "14201",
    },
  }) as unknown as TaxCalculationContext

const lookupContext = (postalCode: string): TaxCalculationContext =>
  ({
    additional_context: {
      remorseless_tax: {
        collectionMode: "collect",
        fingerprint: createTaxContextFingerprint({ postalCode }),
        generation: 1,
        itemAmountsMinor: {},
        itemTaxCodes: {},
        preservedItemRates: {},
        preservedShippingRates: {},
        provider: "taxrate_io",
        shippingAmountMinor: 0,
        subjectId: `cart-${postalCode}`,
      },
    },
    address: {
      country_code: "us",
      postal_code: postalCode,
    },
  }) as unknown as TaxCalculationContext

const stripeContext = ({
  itemAmountsMinor,
  shippingAmountMinor = 0,
  subjectId,
}: {
  itemAmountsMinor: Record<string, number>
  shippingAmountMinor?: number
  subjectId: string
}): TaxCalculationContext =>
  ({
    additional_context: {
      remorseless_tax: {
        collectionMode: "collect",
        fingerprint: createTaxContextFingerprint({
          itemAmountsMinor,
          shippingAmountMinor,
          subjectId,
        }),
        generation: 3,
        itemAmountsMinor,
        itemTaxCodes: Object.fromEntries(
          Object.keys(itemAmountsMinor).map((id) => [id, "txcd_99999999"])
        ),
        preservedItemRates: {},
        preservedShippingRates: {},
        provider: "stripe_tax",
        shippingAmountMinor,
        subjectId,
      },
    },
    address: {
      address_1: "1 Golden Matrix Way",
      city: "Buffalo",
      country_code: "us",
      postal_code: "14201",
      province_code: "ny",
    },
  }) as unknown as TaxCalculationContext

describe("controlled tax provider order rate preservation", () => {
  it("reuses reviewed order rates without requiring another Stripe lookup", async () => {
    await expect(
      service().getTaxLines(
        [item("orli_01")],
        [shipping("ordsm_01")],
        context({ orli_01: 8.75 }, { ordsm_01: 8.75 })
      )
    ).resolves.toEqual([
      expect.objectContaining({
        code: "rr_tax:stripe_tax:g2:taxcalc_original",
        line_item_id: "orli_01",
        rate: 8.75,
      }),
      expect.objectContaining({
        code: "rr_tax:stripe_tax:g2:taxcalc_original",
        rate: 8.75,
        shipping_line_id: "ordsm_01",
      }),
    ])
  })

  it("fails closed when only part of a recalculation has preserved rates", async () => {
    await expect(
      service().getTaxLines(
        [item("orli_01"), item("orli_02")],
        [],
        context({ orli_01: 8.75 }, {})
      )
    ).rejects.toThrow("preserved order rates are incomplete")
  })
})

describe("controlled tax provider disabled collection", () => {
  it("emits one explicit zero line per subject without a provider call", async () => {
    const disabledContext = {
      ...lookupContext("10001"),
      additional_context: {
        remorseless_tax: {
          collectionMode: "disabled",
          fingerprint: createTaxContextFingerprint({ cart: "cart-disabled" }),
          generation: 4,
          itemAmountsMinor: {},
          itemTaxCodes: {},
          preservedItemRates: {},
          preservedShippingRates: {},
          shippingAmountMinor: 500,
          subjectId: "cart-disabled",
        },
      },
    } as unknown as TaxCalculationContext

    await expect(
      service().getTaxLines(
        [item("item-disabled")],
        [shipping("shipping-disabled")],
        disabledContext
      )
    ).resolves.toEqual([
      expect.objectContaining({
        code: "rr_tax:disabled:g4:decision",
        data: {
          collection_mode: "disabled",
          fingerprint: expect.any(String),
          generation: 4,
        },
        line_item_id: "item-disabled",
        name: "Tax not collected",
        rate: 0,
      }),
      expect.objectContaining({
        code: "rr_tax:disabled:g4:decision",
        rate: 0,
        shipping_line_id: "shipping-disabled",
      }),
    ])
    expect(mockFetchTaxRateIo).not.toHaveBeenCalled()
  })
})

describe("controlled tax provider golden quote matrix", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRetrieveStripeTaxCalculation.mockRejectedValue(
      new Error("The golden matrix must not retrieve an unrelated quote.")
    )
  })

  const goldenQuoteCases: {
    itemAmountsMinor: Record<string, number>
    itemTaxes: Record<string, number>
    objective: string
    shippingAmountMinor: number
    shippingTax: number
  }[] = [
    {
      itemAmountsMinor: { item_taxable: 2_500 },
      itemTaxes: { item_taxable: 185 },
      objective: "tax.golden.taxable",
      shippingAmountMinor: 0,
      shippingTax: 0,
    },
    {
      itemAmountsMinor: { item_nontaxable: 2_500 },
      itemTaxes: { item_nontaxable: 0 },
      objective: "tax.golden.nontaxable",
      shippingAmountMinor: 0,
      shippingTax: 0,
    },
    {
      itemAmountsMinor: {
        item_nontaxable: 1_200,
        item_taxable: 2_500,
      },
      itemTaxes: { item_nontaxable: 0, item_taxable: 185 },
      objective: "tax.golden.mixed",
      shippingAmountMinor: 0,
      shippingTax: 0,
    },
    {
      itemAmountsMinor: { item_shipping_case: 2_500 },
      itemTaxes: { item_shipping_case: 0 },
      objective: "tax.golden.shipping_taxed",
      shippingAmountMinor: 500,
      shippingTax: 40,
    },
    {
      itemAmountsMinor: { item_discounted: 1_500 },
      itemTaxes: { item_discounted: 120 },
      objective: "tax.golden.discounted",
      shippingAmountMinor: 0,
      shippingTax: 0,
    },
  ]

  it.each(goldenQuoteCases)(
    "$objective maps provider minor units to exact Medusa rates",
    async ({
      itemAmountsMinor,
      itemTaxes,
      objective,
      shippingAmountMinor,
      shippingTax,
    }) => {
      const itemIds = Object.keys(itemAmountsMinor)
      const totalSubtotal = Object.values(itemAmountsMinor).reduce(
        (total, amount) => total + amount,
        shippingAmountMinor
      )
      const totalTax = Object.values(itemTaxes).reduce(
        (total, amount) => total + amount,
        shippingTax
      )
      mockCreateStripeTaxCalculation.mockResolvedValue({
        amountTotal: totalSubtotal + totalTax,
        calculationId: `taxcalc_${objective.replaceAll(".", "_")}`,
        currency: "usd",
        expiresAt: 1_800_000_000,
        itemTaxByReference: itemTaxes,
        livemode: false,
        shippingTax,
        taxAmountExclusive: totalTax,
      })

      const shippingLines = shippingAmountMinor
        ? [shipping("shipping_golden")]
        : []
      const lines = await service({
        stripeApiKey: "sk_test_golden_matrix",
      }).getTaxLines(
        itemIds.map(item),
        shippingLines,
        stripeContext({
          itemAmountsMinor,
          shippingAmountMinor,
          subjectId: `cart-${objective}`,
        })
      )

      for (const id of itemIds) {
        const amount = itemAmountsMinor[id]!
        const tax = itemTaxes[id]!
        const expectedRate =
          tax === 0 ? 0 : Number(((tax / amount) * 100).toFixed(12))
        expect(lines).toContainEqual(
          expect.objectContaining({
            line_item_id: id,
            rate: expectedRate,
          })
        )
      }
      if (shippingAmountMinor) {
        expect(lines).toContainEqual(
          expect.objectContaining({
            rate: Number(
              ((shippingTax / shippingAmountMinor) * 100).toFixed(12)
            ),
            shipping_line_id: "shipping_golden",
          })
        )
      }
      expect(mockCreateStripeTaxCalculation).toHaveBeenCalledWith(
        expect.objectContaining({
          itemLines: itemIds.map((id) =>
            expect.objectContaining({
              amount: itemAmountsMinor[id],
              reference: id,
            })
          ),
          ...(shippingAmountMinor
            ? {
                shipping: expect.objectContaining({
                  amount: shippingAmountMinor,
                }),
              }
            : {}),
        })
      )
      expect(mockRetrieveStripeTaxCalculation).not.toHaveBeenCalled()
    }
  )

  it("compares representative Stripe Tax and TaxRate.io quotes without creating a payment", async () => {
    mockCreateStripeTaxCalculation.mockResolvedValue({
      amountTotal: 2_700,
      calculationId: "taxcalc_quote_only_comparison",
      currency: "usd",
      expiresAt: 1_800_000_000,
      itemTaxByReference: { item_comparison: 200 },
      livemode: false,
      shippingTax: 0,
      taxAmountExclusive: 200,
    })
    mockFetchTaxRateIo.mockResolvedValue({
      jurisdiction: null,
      quota: null,
      ratePercent: 8,
    })

    const stripeLines = await service({
      stripeApiKey: "sk_test_quote_only",
    }).getTaxLines(
      [item("item_comparison")],
      [],
      stripeContext({
        itemAmountsMinor: { item_comparison: 2_500 },
        subjectId: "cart-stripe-comparison",
      })
    )
    const taxRateIoLines = await service({
      apiKey: "taxrate_quote_only",
    }).getTaxLines([item("item_comparison")], [], lookupContext("14201"))

    expect(stripeLines).toEqual([
      expect.objectContaining({ line_item_id: "item_comparison", rate: 8 }),
    ])
    expect(taxRateIoLines).toEqual([
      expect.objectContaining({ line_item_id: "item_comparison", rate: 8 }),
    ])
    expect(mockCreateStripeTaxCalculation).toHaveBeenCalledTimes(1)
    expect(mockFetchTaxRateIo).toHaveBeenCalledTimes(1)
  })
})

describe("controlled tax provider local cache", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchTaxRateIo.mockResolvedValue({
      jurisdiction: null,
      quota: null,
      ratePercent: 8.75,
    })
  })

  it("bounds lookup entries and rate-limits key-free capacity warnings", async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger
    const provider = new TaxRateLookupProviderService(
      { logger },
      {
        apiKey: "configured",
        provider: "taxrate_io",
        rateCacheMaxEntries: 1,
        rateCacheTtlMs: 1_000,
      }
    )

    await provider.getTaxLines([item("item-1")], [], lookupContext("10001"))
    await provider.getTaxLines([item("item-2")], [], lookupContext("10002"))
    await provider.getTaxLines([item("item-3")], [], lookupContext("10001"))

    expect(mockFetchTaxRateIo).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "Tax rate local cache reached capacity; least-recently-used entries were evicted."
    )
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain(
      "1000"
    )
  })

  it("rejects invalid programmatic cache settings during construction", () => {
    expect(
      () =>
        new TaxRateLookupProviderService(
          {
            logger: {
              info: jest.fn(),
              warn: jest.fn(),
            } as unknown as Logger,
          },
          {
            apiKey: "configured",
            provider: "taxrate_io",
            stripeQuoteCacheMaxEntries: 1_001,
          }
        )
    ).toThrow("STRIPE_TAX_QUOTE_CACHE_MAX_ENTRIES")
  })
})
