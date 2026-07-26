import { TaxQuoteIdentityError, taxQuoteIdentityFromCart } from "./quote";

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789";

const taxLine = ({
  calculationId = "taxcalc_test",
  fingerprintValue = fingerprint,
  generation = 2,
  provider = "stripe_tax",
  rate = 8.25,
}: {
  calculationId?: string | null;
  fingerprintValue?: string;
  generation?: number;
  provider?: "stripe_tax" | "taxrate_io";
  rate?: number;
} = {}) => ({
  code: `rr_tax:${provider}:g${generation}:${calculationId ?? "quote"}`,
  data: {
    ...(calculationId ? { calculation_id: calculationId } : {}),
    fingerprint: fingerprintValue,
    generation,
    provider,
  },
  rate,
});

describe("taxQuoteIdentityFromCart", () => {
  it("extracts one uniform Stripe Tax quote", () => {
    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [taxLine()] }],
        shipping_methods: [{ tax_lines: [taxLine({ rate: 6.5 })] }],
      }),
    ).toEqual({
      calculationId: "taxcalc_test",
      fingerprint,
      generation: 2,
      provider: "stripe_tax",
      taxRatePercent: null,
    });
  });

  it("extracts the uniform TaxRate.io percentage", () => {
    const line = taxLine({
      calculationId: null,
      generation: 4,
      provider: "taxrate_io",
      rate: 7.125,
    });

    expect(
      taxQuoteIdentityFromCart({
        items: [{ tax_lines: [line] }],
        shipping_methods: [{ tax_lines: [line] }],
      }),
    ).toEqual({
      calculationId: null,
      fingerprint,
      generation: 4,
      provider: "taxrate_io",
      taxRatePercent: 7.125,
    });
  });

  it.each([
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
    expect(() => taxQuoteIdentityFromCart(cart)).toThrow(TaxQuoteIdentityError);
  });
});
