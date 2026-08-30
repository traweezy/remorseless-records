import {
  buildTaxLineCode,
  createTaxContextFingerprint,
  parseTaxControlContext,
  parseTaxLineCode,
} from "./context"

const validContext = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  collectionMode: "collect",
  fingerprint: createTaxContextFingerprint({ cart: "cart_1" }),
  generation: 3,
  itemAmountsMinor: { item_1: 1_999 },
  itemTaxCodes: { item_1: "txcd_30011000" },
  preservedItemRates: { item_1: 8.75 },
  preservedShippingRates: { shipping_1: "8.75" },
  provider: "stripe_tax",
  shippingAmountMinor: 500,
  subjectId: "cart_1",
  ...overrides,
})

describe("tax control context", () => {
  it("parses a fully validated provider snapshot", () => {
    expect(
      parseTaxControlContext({
        remorseless_tax: validContext(),
      })
    ).toMatchObject({
      collectionMode: "collect",
      generation: 3,
      itemAmountsMinor: { item_1: 1_999 },
      itemTaxCodes: { item_1: "txcd_30011000" },
      preservedItemRates: { item_1: 8.75 },
      preservedShippingRates: { shipping_1: 8.75 },
      provider: "stripe_tax",
      shippingAmountMinor: 500,
      subjectId: "cart_1",
    })
  })

  it.each([
    ["item amount", { itemAmountsMinor: { item_1: true } }],
    ["tax code", { itemTaxCodes: { item_1: "not-a-tax-code" } }],
    ["preserved rate", { preservedItemRates: { item_1: false } }],
    ["shipping amount", { shippingAmountMinor: "" }],
    [
      "frozen quote",
      {
        frozenQuote: {
          collectionMode: "collect",
          generation: 3,
          provider: "stripe_tax",
          stripeCalculationId: true,
        },
      },
    ],
  ])("rejects a coercive or malformed %s", (_label, override) => {
    expect(() =>
      parseTaxControlContext({
        remorseless_tax: validContext(override),
      })
    ).toThrow("Tax provider control context is invalid.")
  })

  it("round trips a Stripe calculation identity", () => {
    const code = buildTaxLineCode({
      calculationId: "taxcalc_123",
      collectionMode: "collect",
      generation: 4,
      provider: "stripe_tax",
    })

    expect(parseTaxLineCode(code)).toEqual({
      calculationId: "taxcalc_123",
      collectionMode: "collect",
      generation: 4,
      provider: "stripe_tax",
    })
  })

  it("round trips an explicit disabled decision without a provider", () => {
    const code = buildTaxLineCode({
      collectionMode: "disabled",
      generation: 5,
      provider: null,
    })

    expect(code).toBe("rr_tax:disabled:g5:decision")
    expect(parseTaxLineCode(code)).toEqual({
      calculationId: null,
      collectionMode: "disabled",
      generation: 5,
      provider: null,
    })
    expect(
      parseTaxControlContext({
        remorseless_tax: {
          collectionMode: "disabled",
          fingerprint: createTaxContextFingerprint({ cart: "cart_1" }),
          generation: 5,
          itemAmountsMinor: {},
          itemTaxCodes: {},
          shippingAmountMinor: 0,
          subjectId: "cart_1",
        },
      })
    ).toMatchObject({
      collectionMode: "disabled",
      generation: 5,
      provider: null,
    })
  })

  it("rejects a mismatched frozen generation", () => {
    expect(() =>
      parseTaxControlContext({
        remorseless_tax: {
          collectionMode: "collect",
          fingerprint: createTaxContextFingerprint({ cart: "cart_1" }),
          frozenQuote: {
            collectionMode: "collect",
            generation: 1,
            provider: "taxrate_io",
          },
          generation: 2,
          itemAmountsMinor: {},
          itemTaxCodes: {},
          provider: "stripe_tax",
          shippingAmountMinor: 0,
          subjectId: "cart_1",
        },
      })
    ).toThrow("Frozen tax quote does not match")
  })
})
