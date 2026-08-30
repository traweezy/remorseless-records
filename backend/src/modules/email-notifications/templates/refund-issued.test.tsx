import { renderToStaticMarkup } from "react-dom/server"

import {
  isRefundIssuedTemplateData,
  RefundIssuedTemplate,
} from "./refund-issued"

describe("refund issued email", () => {
  it("renders the amount, order reference, note, and bank-safe timing copy", async () => {
    const html = renderToStaticMarkup(
      <RefundIssuedTemplate
        formattedAmount="$12.50"
        note="We refunded the unavailable item."
        referenceLabel="order #42"
      />
    )

    expect(html).toContain("$12.50")
    expect(html).toContain("order #42")
    expect(html).toContain("We refunded the unavailable item.")
    expect(html).toContain("Your bank")
    expect(html).not.toContain("5–10")
  })

  it("validates external template data before rendering", () => {
    expect(
      isRefundIssuedTemplateData({
        formattedAmount: "$12.50",
        note: null,
        referenceLabel: "order #42",
      })
    ).toBe(true)
    expect(
      isRefundIssuedTemplateData({
        formattedAmount: "",
        referenceLabel: "order #42",
      })
    ).toBe(false)
  })
})
