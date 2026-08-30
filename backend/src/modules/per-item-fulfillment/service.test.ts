import {
  calculatePerItemShippingAmount,
  resolveShippingAmount,
} from "./service"
import PerItemFulfillmentService from "./service"

const service = () =>
  new PerItemFulfillmentService(
    { logger: { warn: jest.fn() } as never },
    { additionalAmount: 0.5, baseAmount: 5, currencyCode: "usd" }
  )

const serviceWithDefaultCurrency = () =>
  new PerItemFulfillmentService(
    { logger: { warn: jest.fn() } as never },
    { additionalAmount: 0.5, baseAmount: 5 }
  )

const context = (items: unknown, currencyCode: unknown = "usd") =>
  ({
    currency_code: currencyCode,
    items,
  }) as never

describe("per-item fulfillment major-unit amounts", () => {
  it("preserves two-decimal shipping configuration", () => {
    expect(resolveShippingAmount(0.5, 1)).toBe(0.5)
    expect(resolveShippingAmount("5.25", 1)).toBe(5.25)
    expect(resolveShippingAmount(undefined, 5)).toBe(5)
  })

  it.each([false, [], {}, "invalid", -1, 1_000_000])(
    "rejects coercive or out-of-range shipping amount %p",
    (amount) => {
      expect(resolveShippingAmount(amount, 5)).toBeNull()
    }
  )

  it("calculates shipping in major units without floating-point residue", () => {
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.5,
        baseAmount: 5,
        itemCount: 3,
      })
    ).toBe(6)
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.1,
        baseAmount: 5.1,
        itemCount: 3,
      })
    ).toBe(5.3)
  })

  it("returns zero when the cart has no physical quantity", () => {
    expect(
      calculatePerItemShippingAmount({
        additionalAmount: 0.5,
        baseAmount: 5,
        itemCount: 0,
      })
    ).toBe(0)
  })

  it.each([1.5, -1, 10_001, false])(
    "rejects unsafe aggregate quantity %p",
    (itemCount) => {
      expect(() =>
        calculatePerItemShippingAmount({
          additionalAmount: 0.5,
          baseAmount: 5,
          itemCount: itemCount as number,
        })
      ).toThrow(RangeError)
    }
  )

  it("calculates a validated USD cart through the provider", async () => {
    await expect(
      service().calculatePrice(
        { additional_amount: "0.5", base_amount: "5" } as never,
        {} as never,
        context([
          { id: "cali_1", quantity: 2 },
          { id: "cali_2", quantity: 1 },
        ])
      )
    ).resolves.toEqual({
      calculated_amount: 6,
      is_calculated_price_tax_inclusive: false,
    })
  })

  it("defaults an omitted provider currency to USD", async () => {
    await expect(
      serviceWithDefaultCurrency().calculatePrice(
        {} as never,
        {} as never,
        context([{ id: "cali_1", quantity: 1 }])
      )
    ).resolves.toEqual({
      calculated_amount: 5,
      is_calculated_price_tax_inclusive: false,
    })
  })

  it.each([
    ["primitive item", [false], "usd", {}],
    ["missing item identity", [{ quantity: 1 }], "usd", {}],
    ["boolean quantity", [{ id: "cali_1", quantity: false }], "usd", {}],
    ["decimal-string quantity", [{ id: "cali_1", quantity: "2.0" }], "usd", {}],
    ["over-limit quantity", [{ id: "cali_1", quantity: 101 }], "usd", {}],
    ["non-USD context", [{ id: "cali_1", quantity: 1 }], "eur", {}],
    [
      "coercive base amount",
      [{ id: "cali_1", quantity: 1 }],
      "usd",
      { base_amount: false },
    ],
    ["array option data", [{ id: "cali_1", quantity: 1 }], "usd", []],
  ])("rejects %s", async (_label, items, currencyCode, optionData) => {
    await expect(
      service().calculatePrice(
        optionData as never,
        {} as never,
        context(items, currencyCode)
      )
    ).rejects.toThrow("The per-item shipping calculation data is invalid.")
  })

  it("rejects malformed option configuration during validation", async () => {
    await expect(
      service().validateOption({ base_amount: false })
    ).resolves.toBe(false)
    await expect(
      service().validateOption({ currency_code: "eur" })
    ).resolves.toBe(false)
    await expect(service().validateOption([] as never)).resolves.toBe(false)
  })
})
