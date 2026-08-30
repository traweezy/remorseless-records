import { createTaxSubjectFingerprint } from "./subject-fingerprint"

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
})
