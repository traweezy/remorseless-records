import { TaxQuoteIdentityError, taxQuoteIdentityFromCart } from "./quote"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

const taxLine = ({
  calculationId = "taxcalc_test",
  fingerprintValue = fingerprint,
  generation = 2,
  provider = "stripe_tax",
  rate = 8.25,
  collectionMode = "collect",
}: {
  calculationId?: string | null
  fingerprintValue?: string
  generation?: number
  provider?: "stripe_tax" | "taxrate_io"
  rate?: unknown
  collectionMode?: "collect" | "disabled"
} = {}) => ({
  code:
    collectionMode === "disabled"
      ? `rr_tax:disabled:g${generation}:decision`
      : `rr_tax:${provider}:g${generation}:${calculationId ?? "quote"}`,
  data: {
    ...(collectionMode === "collect" && calculationId
      ? { calculation_id: calculationId }
      : {}),
    collection_mode: collectionMode,
    fingerprint: fingerprintValue,
    generation,
    ...(collectionMode === "collect" ? { provider } : {}),
  },
  rate,
})

describe("taxQuoteIdentityFromCart", () => {
  it("extracts one uniform Stripe Tax quote", () => {
    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [taxLine()] }],
        shipping_methods: [{ tax_lines: [taxLine({ rate: 6.5 })] }],
      })
    ).toEqual({
      calculationId: "taxcalc_test",
      collectionMode: "collect",
      fingerprint,
      generation: 2,
      provider: "stripe_tax",
      taxRatePercent: null,
    })
  })

  it("extracts the uniform TaxRate.io percentage", () => {
    const line = taxLine({
      calculationId: null,
      collectionMode: "collect",
      generation: 4,
      provider: "taxrate_io",
      rate: 7.125,
    })

    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line] }],
        shipping_methods: [{ tax_lines: [line] }],
      })
    ).toEqual({
      calculationId: null,
      collectionMode: "collect",
      fingerprint,
      generation: 4,
      provider: "taxrate_io",
      taxRatePercent: 7.125,
    })
  })

  it("extracts an explicit disabled collection decision", () => {
    const line = taxLine({
      calculationId: null,
      collectionMode: "disabled",
      generation: 5,
      rate: 0,
    })

    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line] }],
        shipping_methods: [{ tax_lines: [line] }],
      })
    ).toEqual({
      calculationId: null,
      collectionMode: "disabled",
      fingerprint,
      generation: 5,
      provider: null,
      taxRatePercent: null,
    })
  })

  it.each([
    {
      name: "disabled decision with a nonzero rate",
      cart: {
        items: [
          {
            tax_lines: [
              taxLine({
                calculationId: null,
                collectionMode: "disabled",
                rate: 1,
              }),
            ],
          },
        ],
      },
    },
    {
      name: "missing subject tax lines",
      cart: { items: [{ tax_lines: [] }] },
    },
    {
      name: "mixed generations",
      cart: {
        items: [{ tax_lines: [taxLine()] }],
        shipping_methods: [{ tax_lines: [taxLine({ generation: 3 })] }],
      },
    },
    {
      name: "mismatched data",
      cart: {
        items: [
          {
            tax_lines: [
              {
                ...taxLine(),
                data: { ...taxLine().data, generation: 99 },
              },
            ],
          },
        ],
      },
    },
    {
      name: "Stripe quote without a calculation",
      cart: {
        items: [{ tax_lines: [taxLine({ calculationId: null })] }],
      },
    },
    {
      name: "mixed TaxRate.io rates",
      cart: {
        items: [
          {
            tax_lines: [
              taxLine({
                calculationId: null,
                provider: "taxrate_io",
                rate: 6,
              }),
            ],
          },
        ],
        shipping_methods: [
          {
            tax_lines: [
              taxLine({
                calculationId: null,
                provider: "taxrate_io",
                rate: 7,
              }),
            ],
          },
        ],
      },
    },
  ])("rejects $name", ({ cart }) => {
    expect(() => taxQuoteIdentityFromCart(cart)).toThrow(TaxQuoteIdentityError)
  })

  it.each([
    ["primitive subject", { items: [false] }],
    ["primitive tax line", { items: [{ tax_lines: [false] }] }],
    [
      "coercive generation",
      {
        items: [
          {
            tax_lines: [
              {
                ...taxLine(),
                data: { ...taxLine().data, generation: true },
              },
            ],
          },
        ],
      },
    ],
    ["coercive rate", { items: [{ tax_lines: [taxLine({ rate: true })] }] }],
    ["out-of-range rate", { items: [{ tax_lines: [taxLine({ rate: 101 })] }] }],
  ])("rejects a malformed %s boundary", (_label, cart) => {
    expect(() => taxQuoteIdentityFromCart(cart)).toThrow(TaxQuoteIdentityError)
  })
})
