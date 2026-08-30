import {
  createTaxSubjectFingerprint,
  taxSubjectFingerprintMatches,
} from "./subject-fingerprint"

const taxSubject = ({
  shippingAmount = 5,
  shippingMethodId = "casm_original",
  shippingOptionId = "so_standard",
}: {
  shippingAmount?: number
  shippingMethodId?: string
  shippingOptionId?: string
} = {}) => ({
  id: "cart_01",
  currency_code: "usd",
  items: [
    {
      id: "cali_01",
      product_id: "prod_01",
      product_type_id: "ptyp_01",
      quantity: 1,
      unit_price: 10,
      adjustments: [],
    },
  ],
  shipping_address: {
    address_1: "1 Test Way",
    city: "New York",
    country_code: "us",
    postal_code: "10001",
    province: "NY",
  },
  shipping_methods: [
    {
      id: shippingMethodId,
      shipping_option_id: shippingOptionId,
      amount: shippingAmount,
      adjustments: [],
    },
  ],
})

describe("tax subject fingerprint", () => {
  it("survives replacement of the selected shipping-method row", () => {
    const original = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: taxSubject(),
      provider: "taxrate_io",
    })
    const replaced = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: taxSubject({ shippingMethodId: "casm_replacement" }),
      provider: "taxrate_io",
    })

    expect(replaced).toBe(original)
  })

  it.each([
    ["selected option", { shippingOptionId: "so_express" }],
    ["shipping amount", { shippingAmount: 8 }],
  ])("changes when the %s changes", (_name, change) => {
    const original = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: taxSubject(),
      provider: "taxrate_io",
    })
    const changed = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: taxSubject(change),
      provider: "taxrate_io",
    })

    expect(changed).not.toBe(original)
  })

  it("separates an explicit disabled decision from provider collection", () => {
    const collected = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 2,
      orderOrCart: taxSubject(),
      provider: "taxrate_io",
    })
    const disabled = createTaxSubjectFingerprint({
      collectionMode: "disabled",
      generation: 2,
      orderOrCart: taxSubject(),
      provider: null,
    })

    expect(disabled).not.toBe(collected)
  })

  it("normalizes explicit numeric wrappers without changing the subject", () => {
    const original = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: taxSubject(),
      provider: "taxrate_io",
    })
    const wrapped = taxSubject()
    const [item] = wrapped.items
    const [shippingMethod] = wrapped.shipping_methods
    const normalized = createTaxSubjectFingerprint({
      collectionMode: "collect",
      generation: 1,
      orderOrCart: {
        ...wrapped,
        items: [{ ...item, quantity: "1", unit_price: { value: "10" } }],
        shipping_methods: [{ ...shippingMethod, amount: { value: "5" } }],
      },
      provider: "taxrate_io",
    })

    expect(normalized).toBe(original)
  })

  it("accepts a validated legacy wrapper hash only for frozen compatibility", () => {
    const wrapped = taxSubject()
    expect(
      taxSubjectFingerprintMatches({
        collectionMode: "collect",
        fingerprint: "kc3EtdkStbOYJffulgzpYB686qGizO4Tl6iVz51amls",
        generation: 1,
        orderOrCart: {
          ...wrapped,
          items: [
            {
              ...wrapped.items[0],
              unit_price: { value: "10" },
            },
          ],
          shipping_methods: [
            {
              ...wrapped.shipping_methods[0],
              amount: { value: "5" },
            },
          ],
        },
        provider: "taxrate_io",
      })
    ).toBe(true)
  })

  it.each([
    ["primitive item", { ...taxSubject(), items: [false] }],
    [
      "coercive quantity",
      {
        ...taxSubject(),
        items: [{ ...taxSubject().items[0], quantity: true }],
      },
    ],
    [
      "duplicate item",
      {
        ...taxSubject(),
        items: [taxSubject().items[0], taxSubject().items[0]],
      },
    ],
    [
      "coercive shipping amount",
      {
        ...taxSubject(),
        shipping_methods: [
          { ...taxSubject().shipping_methods[0], amount: false },
        ],
      },
    ],
    ["invalid currency", { ...taxSubject(), currency_code: true }],
  ])("rejects a malformed %s boundary", (_label, orderOrCart) => {
    expect(() =>
      createTaxSubjectFingerprint({
        collectionMode: "collect",
        generation: 1,
        orderOrCart,
        provider: "taxrate_io",
      })
    ).toThrow("Tax subject fingerprint data is invalid")
  })
})
