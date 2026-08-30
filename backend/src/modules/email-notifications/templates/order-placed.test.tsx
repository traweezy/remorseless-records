import { renderToStaticMarkup } from "react-dom/server"

import {
  isOrderPlacedTemplateData,
  OrderPlacedTemplate,
  type OrderPlacedTemplateProps,
} from "./order-placed"

const templateData = {
  order: {
    created_at: "2026-08-29T12:00:00.000Z",
    currency_code: "usd",
    display_id: "42",
    items: [
      {
        id: "item_01",
        product_title: "Test release",
        quantity: 1,
        title: "Test release",
        unit_price: 1,
      },
    ],
    summary: { raw_current_order_total: { value: "6.5325" } },
  },
  shippingAddress: {
    address_1: "1 Test Way",
    city: "New York",
    country_code: "US",
    first_name: "Test",
    last_name: "Customer",
    postal_code: "10001",
    province: "NY",
  },
} as unknown as OrderPlacedTemplateProps

describe("order placed email", () => {
  it("renders cent-rounded currency totals and item prices", () => {
    const html = renderToStaticMarkup(<OrderPlacedTemplate {...templateData} />)

    expect(html).toContain("Total: $6.53")
    expect(html).toContain("$1.00")
    expect(html).not.toContain("6.5325 usd")
  })

  it("rejects invalid monetary template data", () => {
    expect(isOrderPlacedTemplateData(templateData)).toBe(true)
    expect(
      isOrderPlacedTemplateData({
        ...templateData,
        order: {
          ...templateData.order,
          summary: { raw_current_order_total: { value: "invalid" } },
        },
      })
    ).toBe(false)
    expect(
      isOrderPlacedTemplateData({
        ...templateData,
        order: {
          ...templateData.order,
          items: [{ unit_price: null }],
        },
      })
    ).toBe(false)
  })
})
