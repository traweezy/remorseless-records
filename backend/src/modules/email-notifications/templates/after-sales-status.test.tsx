import { renderToStaticMarkup } from "react-dom/server"

import { generateEmailTemplate } from "./index"
import {
  AFTER_SALES_COPY,
  AfterSalesStatusTemplate,
  isAfterSalesStatusTemplateData,
} from "./after-sales-status"

describe("after-sales status email", () => {
  it.each(Object.keys(AFTER_SALES_COPY) as (keyof typeof AFTER_SALES_COPY)[])(
    "renders truthful accessible copy for %s",
    (status) => {
      const html = renderToStaticMarkup(
        <AfterSalesStatusTemplate orderDisplayId={42} status={status} />
      )
      expect(html).toContain('lang="en" dir="ltr"')
      expect(html).toContain(`<title>${AFTER_SALES_COPY[status].title}</title>`)
      expect(html).toContain("Order #42")
      expect(html).toContain(AFTER_SALES_COPY[status].message)
      expect(html).toContain("separate update")
      expect(html.match(/<h1\b/g)).toHaveLength(1)
      expect(html).not.toMatch(
        /address_1|tracking_url|private-item|refund_amount/
      )
      expect(
        renderToStaticMarkup(
          generateEmailTemplate("after-sales-status", {
            orderDisplayId: 42,
            status,
          })
        )
      ).toContain("Order #42")
    }
  )
  it.each([
    null,
    [],
    { orderDisplayId: 0, status: "return-requested" },
    { orderDisplayId: "42", status: "return-received" },
    { orderDisplayId: Infinity, status: "claim-confirmed" },
    { orderDisplayId: 42, status: "toString" },
    { orderDisplayId: 42, status: "refunded" },
    {
      orderDisplayId: 42,
      status: "return-requested",
      tracking_url: "javascript:alert(1)",
    },
  ])("rejects malformed and excessive projections", (data) => {
    expect(isAfterSalesStatusTemplateData(data)).toBe(false)
    expect(() => generateEmailTemplate("after-sales-status", data)).toThrow()
  })
})
