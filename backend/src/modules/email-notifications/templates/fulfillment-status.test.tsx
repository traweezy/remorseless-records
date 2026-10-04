import { renderToStaticMarkup } from "react-dom/server"

import { generateEmailTemplate } from "./index"
import {
  FULFILLMENT_COPY,
  FulfillmentStatusTemplate,
  isFulfillmentStatusTemplateData,
} from "./fulfillment-status"

describe("fulfillment status email", () => {
  it.each(["prepared", "shipped", "delivered"] as const)(
    "renders accessible partial-shipment copy for %s",
    (status) => {
      const html = renderToStaticMarkup(
        <FulfillmentStatusTemplate orderDisplayId={42} status={status} />
      )
      expect(html).toContain('lang="en" dir="ltr"')
      expect(html).toContain(`<title>${FULFILLMENT_COPY[status].title}</title>`)
      expect(html).toContain("Order #42")
      expect(html).toContain("separate shipments")
      expect(html).toContain(FULFILLMENT_COPY[status].message)
      expect(html.match(/<h1\b/g)).toHaveLength(1)
      expect(html).not.toMatch(/private-label|address_1|tracking_url/)
      expect(html.indexOf("<body")).toBeLessThan(html.indexOf("display:none"))
    }
  )

  it.each([
    null,
    [],
    { orderDisplayId: 0, status: "shipped" },
    { orderDisplayId: "42", status: "shipped" },
    { orderDisplayId: false, status: "shipped" },
    { orderDisplayId: Infinity, status: "shipped" },
    { orderDisplayId: 42, status: "canceled" },
    {
      orderDisplayId: 42,
      status: "shipped",
      tracking_url: "javascript:alert(1)",
    },
  ])("rejects malformed or excessive template projections", (data) => {
    expect(isFulfillmentStatusTemplateData(data)).toBe(false)
    expect(() => generateEmailTemplate("fulfillment-status", data)).toThrow()
  })

  it("registers and renders the minimal provider projection", () => {
    const data = {
      emailOptions: { subject: FULFILLMENT_COPY.shipped.title },
      orderDisplayId: 42,
      status: "shipped",
    }
    expect(isFulfillmentStatusTemplateData(data)).toBe(true)
    expect(
      renderToStaticMarkup(generateEmailTemplate("fulfillment-status", data))
    ).toContain("Order #42")
  })
})
