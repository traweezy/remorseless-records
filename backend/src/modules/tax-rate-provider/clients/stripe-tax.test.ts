import type Stripe from "stripe"

import {
  createStripeTaxCalculation,
  retrieveStripeTaxCalculation,
} from "./stripe-tax"

const calculation = {
  amount_total: 3_200,
  currency: "usd",
  expires_at: 1_800_000_000,
  id: "taxcalc_example",
  line_items: {
    data: [
      {
        amount_tax: 185,
        reference: "item_1",
      },
    ],
    has_more: false,
  },
  livemode: false,
  shipping_cost: {
    amount_tax: 15,
  },
  tax_amount_exclusive: 200,
} as unknown as Stripe.Tax.Calculation

const clientWith = (
  overrides: Partial<Stripe["tax"]["calculations"]> = {}
): Pick<Stripe, "tax"> =>
  ({
    tax: {
      calculations: {
        create: jest.fn().mockResolvedValue(calculation),
        listLineItems: jest.fn(),
        retrieve: jest.fn().mockResolvedValue(calculation),
        ...overrides,
      },
    },
  }) as unknown as Pick<Stripe, "tax">

describe("Stripe Tax calculation client", () => {
  it("creates an exclusive calculation with full address and stable references", async () => {
    const client = clientWith()

    const result = await createStripeTaxCalculation({
      address: {
        address1: "1 Main Street",
        city: "Stamford",
        countryCode: "us",
        postalCode: "06902",
        provinceCode: "ct",
      },
      client,
      currency: "USD",
      idempotencyKey: "tax-cart-fingerprint",
      itemLines: [
        {
          amount: 2_500,
          quantity: 2,
          reference: "item_1",
          taxCode: "txcd_99999999",
        },
      ],
      shipping: {
        amount: 500,
        taxCode: "txcd_92010001",
      },
    })

    expect(client.tax.calculations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "usd",
        customer_details: {
          address: {
            city: "Stamford",
            country: "US",
            line1: "1 Main Street",
            postal_code: "06902",
            state: "CT",
          },
          address_source: "shipping",
        },
        line_items: [
          {
            amount: 2_500,
            quantity: 2,
            reference: "item_1",
            tax_behavior: "exclusive",
            tax_code: "txcd_99999999",
          },
        ],
      }),
      { idempotencyKey: "tax-cart-fingerprint" }
    )
    expect(result).toEqual({
      amountTotal: 3_200,
      calculationId: "taxcalc_example",
      currency: "usd",
      expiresAt: 1_800_000_000,
      itemTaxByReference: { item_1: 185 },
      livemode: false,
      shippingTax: 15,
      taxAmountExclusive: 200,
    })
  })

  it("retrieves a frozen calculation without creating a new billable lookup", async () => {
    const client = clientWith()

    await retrieveStripeTaxCalculation({
      calculationId: "taxcalc_example",
      client,
    })

    expect(client.tax.calculations.retrieve).toHaveBeenCalledWith(
      "taxcalc_example",
      { expand: ["line_items"] }
    )
    expect(client.tax.calculations.create).not.toHaveBeenCalled()
  })
})
