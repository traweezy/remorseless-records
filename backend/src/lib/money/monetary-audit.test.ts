import {
  auditMonetaryRecord,
  buildMonetaryAuditSummary,
  parseDatabaseAmount,
  type MonetaryAuditInput,
} from "./monetary-audit"

const record = (
  overrides: Partial<MonetaryAuditInput> = {}
): MonetaryAuditInput => ({
  amount: 1_200,
  currencyCode: "USD",
  id: "price_01TEST",
  source: "active_product_price",
  ...overrides,
})

describe("monetary unit audit", () => {
  it("parses database numerics without accepting invalid amounts", () => {
    expect(parseDatabaseAmount("2300")).toBe(2_300)
    expect(parseDatabaseAmount(10)).toBe(10)
    expect(() => parseDatabaseAmount("-1")).toThrow("non-negative")
    expect(() => parseDatabaseAmount("not-a-number")).toThrow("non-negative")
  })

  it("proposes major-unit conversion for active legacy product and cart rows", () => {
    expect(auditMonetaryRecord(record())).toMatchObject({
      action: "convert_legacy_minor_to_major",
      amount: 1_200,
      currencyCode: "usd",
      proposedMajorAmount: 12,
    })
    expect(
      auditMonetaryRecord(
        record({
          amount: 2_300,
          id: "line_01TEST",
          source: "active_incomplete_cart_line_price",
        })
      )
    ).toMatchObject({
      action: "convert_legacy_minor_to_major",
      proposedMajorAmount: 23,
    })
  })

  it("preserves shipping-option price rows already stored in major units", () => {
    expect(
      auditMonetaryRecord(
        record({
          amount: 5,
          id: "price_shipping",
          source: "shipping_option_price",
        })
      )
    ).toMatchObject({
      action: "preserve_major",
      proposedMajorAmount: 5,
    })
  })

  it("preserves all current monetary records after the major-unit cutover", () => {
    expect(auditMonetaryRecord(record({ amount: 12 }), "major")).toMatchObject({
      action: "preserve_major",
      proposedMajorAmount: 12,
    })
  })

  it("requires manual review for transactional and fractional legacy rows", () => {
    expect(
      auditMonetaryRecord(
        record({
          id: "payment_01TEST",
          source: "transactional_record",
        })
      )
    ).toMatchObject({
      action: "manual_review",
      proposedMajorAmount: null,
    })
    expect(auditMonetaryRecord(record({ amount: 12.5 }))).toMatchObject({
      action: "manual_review",
      proposedMajorAmount: null,
    })
  })

  it("produces an order-independent manifest fingerprint", () => {
    const first = record()
    const second = record({
      amount: 10,
      id: "price_shipping",
      source: "shipping_option_price",
    })

    const forward = buildMonetaryAuditSummary([first, second])
    const reverse = buildMonetaryAuditSummary([second, first])

    expect(forward).toMatchObject({
      bySource: {
        active_product_price: 1,
        shipping_option_price: 1,
      },
      manualReviewRecords: 0,
      mode: "legacy_minor",
      preservedRecords: 1,
      proposedConversions: 1,
      totalRecords: 2,
    })
    expect(forward.manifestSha256).toBe(reverse.manifestSha256)
    expect(forward.manifestSha256).toHaveLength(64)
  })

  it("rejects duplicate source identities", () => {
    expect(() => buildMonetaryAuditSummary([record(), record()])).toThrow(
      "Duplicate monetary record"
    )
  })

  it("rejects an amount linked to conflicting monetary sources", () => {
    expect(() =>
      buildMonetaryAuditSummary([
        record(),
        record({ source: "shipping_option_price" }),
      ])
    ).toThrow("conflicting sources")
  })
})
