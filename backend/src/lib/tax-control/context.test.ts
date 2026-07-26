import {
  buildTaxLineCode,
  createTaxContextFingerprint,
  parseTaxControlContext,
  parseTaxLineCode,
} from "./context";

describe("tax control context", () => {
  it("parses a validated provider snapshot and ignores invalid tax codes", () => {
    expect(
      parseTaxControlContext({
        remorseless_tax: {
          fingerprint: createTaxContextFingerprint({ cart: "cart_1" }),
          generation: 3,
          itemAmountsMinor: {
            item_1: 1_999,
            item_invalid: -1,
          },
          itemTaxCodes: {
            item_1: "txcd_30011000",
            item_2: "not-a-tax-code",
          },
          preservedItemRates: {
            item_1: 8.75,
            item_invalid: -1,
          },
          preservedShippingRates: {
            shipping_1: "8.75",
          },
          provider: "stripe_tax",
          shippingAmountMinor: 500,
          subjectId: "cart_1",
        },
      }),
    ).toMatchObject({
      generation: 3,
      itemAmountsMinor: { item_1: 1_999 },
      itemTaxCodes: { item_1: "txcd_30011000" },
      preservedItemRates: { item_1: 8.75 },
      preservedShippingRates: { shipping_1: 8.75 },
      provider: "stripe_tax",
      shippingAmountMinor: 500,
      subjectId: "cart_1",
    });
  });

  it("round trips a Stripe calculation identity", () => {
    const code = buildTaxLineCode({
      calculationId: "taxcalc_123",
      generation: 4,
      provider: "stripe_tax",
    });

    expect(parseTaxLineCode(code)).toEqual({
      calculationId: "taxcalc_123",
      generation: 4,
      provider: "stripe_tax",
    });
  });

  it("rejects a mismatched frozen generation", () => {
    expect(() =>
      parseTaxControlContext({
        remorseless_tax: {
          fingerprint: createTaxContextFingerprint({ cart: "cart_1" }),
          frozenQuote: {
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
      }),
    ).toThrow("Frozen tax quote does not match");
  });
});
